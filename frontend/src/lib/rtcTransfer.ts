// Uçtan uca (P2P) dosya aktarımı — WebRTC DataChannel.
//
// Dosya hiçbir zaman sunucuya yüklenmez; iki tarayıcı arasında doğrudan akar.
// Sinyalleşme (SDP offer/answer + ICE adayları) mevcut WebSocket üzerinden
// karşı tarafa relay edilir: backend `RTC_SIGNAL` mesajını booking'in diğer
// katılımcısına iletir. Bağlantı kurulumu için public STUN kullanılır; simetrik/
// kısıtlı NAT'larda bağlantı kurulamayabilir (ileride TURN gerekebilir).
//
// Aynı anda tek aktif aktarım desteklenir; meşgulken gelen teklif reddedilir.

import { useMeetingStore } from "@/store/meetingStore";
import { useRtcStore } from "@/store/rtcStore";
import { useWsStore } from "@/store/wsStore";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Tanılama: konsola WebRTC akış loglarını basar. Sorun giderirken true yap.
const DEBUG = false;
function log(...args: unknown[]) {
  if (DEBUG) console.log("[P2P]", ...args);
}

const CHUNK_SIZE = 16 * 1024; // 16 KB
const HIGH_WATER_MARK = 8 * 1024 * 1024; // 8 MB — üstündeyse drenajı bekle
const LOW_WATER_MARK = 1 * 1024 * 1024; // 1 MB
const EOF = "__EOF__";

type Signal =
  | { kind: "offer"; transferId: string; sdp: RTCSessionDescriptionInit; file: { name: string; size: number; type: string } }
  | { kind: "answer"; transferId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; transferId: string; candidate: RTCIceCandidateInit }
  | { kind: "reject"; transferId: string }
  | { kind: "cancel"; transferId: string };

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class RtcTransferManager {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private transferId: string | null = null;
  private remoteReady = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  // gönderen tarafı
  private fileToSend: File | null = null;
  private aborted = false;
  private answered = false; // gönderen: bir answer kabul edildi mi (ilk answer kazanır)
  private rejectTimer: ReturnType<typeof setTimeout> | null = null;

  // alıcı tarafı
  private incomingOffer: Extract<Signal, { kind: "offer" }> | null = null;
  private chunks: ArrayBuffer[] = [];
  private received = 0;

  // ── Sinyal gönderimi ──────────────────────────────────────────────
  private sendSignal(signal: Signal) {
    const bookingId = useMeetingStore.getState().bookingId;
    const socket = useWsStore.getState().socket;
    if (bookingId == null || !socket || socket.readyState !== WebSocket.OPEN) {
      log("sinyal GÖNDERİLEMEDİ", {
        kind: signal.kind,
        bookingId,
        socket: socket?.readyState,
      });
      return false;
    }
    log("sinyal →", signal.kind, "booking", bookingId);
    socket.send(JSON.stringify({ type: "RTC_SIGNAL", booking_id: bookingId, signal }));
    return true;
  }

  // ── Gönderen: dosya yolla ─────────────────────────────────────────
  async sendFile(file: File) {
    if (useRtcStore.getState().active) {
      return; // meşgul
    }
    this.cleanup();
    const transferId = randomId();
    this.transferId = transferId;
    this.fileToSend = file;
    this.aborted = false;

    useRtcStore.getState().setActive({
      transferId,
      direction: "send",
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || "application/octet-stream",
      transferred: 0,
      status: "connecting",
    });

    const pc = this.createPeer(transferId);
    const channel = pc.createDataChannel("file");
    channel.binaryType = "arraybuffer";
    this.channel = channel;
    channel.onopen = () => this.streamFile();
    channel.onerror = () => this.fail("Veri kanalı hatası.");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const ok = this.sendSignal({
      kind: "offer",
      transferId,
      sdp: offer,
      file: { name: file.name, size: file.size, type: file.type || "application/octet-stream" },
    });
    if (!ok) this.fail("Bağlantı yok — sinyal gönderilemedi.");
  }

  private async streamFile() {
    const file = this.fileToSend;
    const channel = this.channel;
    if (!file || !channel) return;
    useRtcStore.getState().patchActive({ status: "transferring", transferred: 0 });
    channel.bufferedAmountLowThreshold = LOW_WATER_MARK;

    let offset = 0;
    try {
      while (offset < file.size) {
        if (this.aborted) return;
        if (channel.bufferedAmount > HIGH_WATER_MARK) {
          await this.waitForDrain(channel);
          if (this.aborted) return;
        }
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        channel.send(buf);
        offset += buf.byteLength;
        useRtcStore.getState().patchActive({ transferred: offset });
      }
      channel.send(EOF);
      useRtcStore.getState().patchActive({ status: "done", transferred: file.size });
    } catch {
      this.fail("Dosya gönderilirken hata oluştu.");
    }
  }

  private waitForDrain(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const handler = () => {
        channel.removeEventListener("bufferedamountlow", handler);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", handler);
    });
  }

  // ── Alıcı: gelen teklifi kabul / reddet ───────────────────────────
  async acceptIncoming() {
    const offer = this.incomingOffer;
    if (!offer) return;
    const transferId = offer.transferId;
    this.transferId = transferId;
    this.chunks = [];
    this.received = 0;

    useRtcStore.getState().patchActive({ status: "connecting" });

    const pc = this.createPeer(transferId);
    pc.ondatachannel = (e) => {
      const channel = e.channel;
      channel.binaryType = "arraybuffer";
      this.channel = channel;
      channel.onmessage = (ev) => this.onReceiveMessage(ev);
      channel.onerror = () => this.fail("Veri kanalı hatası.");
    };

    await pc.setRemoteDescription(offer.sdp);
    this.remoteReady = true;
    await this.drainCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignal({ kind: "answer", transferId, sdp: answer });
    this.incomingOffer = null;
  }

  rejectIncoming() {
    if (this.transferId) this.sendSignal({ kind: "reject", transferId: this.transferId });
    this.incomingOffer = null;
    useRtcStore.getState().patchActive({ status: "rejected" });
    this.cleanup();
  }

  private onReceiveMessage(ev: MessageEvent) {
    const data = ev.data;
    if (typeof data === "string") {
      if (data === EOF) this.finalizeReceive();
      return;
    }
    const buf = data as ArrayBuffer;
    this.chunks.push(buf);
    this.received += buf.byteLength;
    useRtcStore.getState().patchActive({ status: "transferring", transferred: this.received });
  }

  private finalizeReceive() {
    const active = useRtcStore.getState().active;
    const blob = new Blob(this.chunks, {
      type: active?.fileType || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    useRtcStore.getState().patchActive({
      status: "done",
      transferred: blob.size,
      downloadUrl: url,
    });
    this.chunks = [];
  }

  // ── İptal ──────────────────────────────────────────────────────────
  cancel() {
    if (this.transferId) this.sendSignal({ kind: "cancel", transferId: this.transferId });
    useRtcStore.getState().patchActive({ status: "cancelled" });
    this.cleanup();
  }

  // Aktarımı kapatıp UI durumunu temizler (kullanıcı "Temizle"ye basınca).
  reset() {
    this.cleanup();
    const url = useRtcStore.getState().active?.downloadUrl;
    if (url) URL.revokeObjectURL(url);
    useRtcStore.getState().clear();
  }

  // ── Sinyal alımı (WsManager çağırır) ──────────────────────────────
  handleSignal(bookingId: number, signal: Signal) {
    const currentBooking = useMeetingStore.getState().bookingId;
    if (currentBooking == null || currentBooking !== bookingId) {
      log(
        "sinyal YOK SAYILDI — bu sekme derste değil/farklı ders.",
        { kind: signal.kind, geleningBooking: bookingId, aktifBooking: currentBooking },
        "→ karşı sekmenin de 'Canlı Derse Katıl' ile derse girmesi gerekir."
      );
      return;
    }
    log("sinyal ←", signal.kind, "booking", bookingId);

    switch (signal.kind) {
      case "offer":
        this.onRemoteOffer(signal);
        break;
      case "answer":
        this.onRemoteAnswer(signal);
        break;
      case "ice":
        this.onRemoteIce(signal);
        break;
      case "reject":
        // Karşı hesabın birden çok sekmesi olabilir: meşgul bir kopya sekme reject
        // gönderirken başka bir sekme kabul edip (answer) bağlanabilir. Bu yüzden
        // reject'te hemen iptal etmeyiz; kısa süre answer gelmezse reddedilmiş sayarız.
        if (signal.transferId === this.transferId && !this.answered) {
          if (this.rejectTimer) clearTimeout(this.rejectTimer);
          this.rejectTimer = setTimeout(() => {
            this.rejectTimer = null;
            if (!this.answered) {
              log("reject kesinleşti (answer gelmedi)");
              useRtcStore.getState().patchActive({ status: "rejected" });
              this.cleanup();
            }
          }, 4000);
        }
        break;
      case "cancel":
        if (signal.transferId === this.transferId) {
          this.aborted = true;
          useRtcStore.getState().patchActive({ status: "cancelled" });
          this.cleanup();
        }
        break;
    }
  }

  private onRemoteOffer(signal: Extract<Signal, { kind: "offer" }>) {
    // Meşgulse otomatik reddet.
    if (useRtcStore.getState().active) {
      this.sendSignal({ kind: "reject", transferId: signal.transferId });
      return;
    }
    this.cleanup();
    this.transferId = signal.transferId;
    this.incomingOffer = signal;
    useRtcStore.getState().setActive({
      transferId: signal.transferId,
      direction: "receive",
      fileName: signal.file.name,
      fileSize: signal.file.size,
      fileType: signal.file.type,
      transferred: 0,
      status: "pending-accept",
    });
  }

  private async onRemoteAnswer(signal: Extract<Signal, { kind: "answer" }>) {
    // İlk answer kazanır; sonraki answer'lar (birden çok kabul eden sekme) yok sayılır.
    if (!this.pc || signal.transferId !== this.transferId || this.answered) return;
    this.answered = true;
    if (this.rejectTimer) {
      clearTimeout(this.rejectTimer);
      this.rejectTimer = null;
    }
    await this.pc.setRemoteDescription(signal.sdp);
    this.remoteReady = true;
    await this.drainCandidates();
  }

  private async onRemoteIce(signal: Extract<Signal, { kind: "ice" }>) {
    if (signal.transferId !== this.transferId) return;
    if (!this.pc || !this.remoteReady) {
      this.pendingCandidates.push(signal.candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(signal.candidate);
    } catch {
      /* yoksay — geç gelen aday */
    }
  }

  private async drainCandidates() {
    if (!this.pc) return;
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of pending) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* yoksay */
      }
    }
  }

  // ── Ortak ──────────────────────────────────────────────────────────
  private createPeer(transferId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.pc = pc;
    this.remoteReady = false;
    // NOT: pendingCandidates burada SIFIRLANMAZ — alıcıda teklif (offer) ile
    // accept arasında gelen ICE adayları tamponlanır; pc kurulduktan sonra
    // drainCandidates ile eklenir. Sıfırlama transfer başında cleanup'ta yapılır.
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({ kind: "ice", transferId, candidate: e.candidate.toJSON() });
      }
    };
    pc.oniceconnectionstatechange = () => log("iceConnectionState:", pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      log("connectionState:", pc.connectionState);
      if (pc.connectionState === "connected") {
        useRtcStore.getState().patchActive({ status: "transferring" });
      }
      if (pc.connectionState === "failed") {
        this.fail(
          "Bağlantı kurulamadı. Karşı tarafın da derse girdiğinden emin ol; sorun sürerse ağ/güvenlik duvarı engelliyor olabilir."
        );
      }
    };
    return pc;
  }

  private fail(message: string) {
    useRtcStore.getState().patchActive({ status: "error", error: message });
    this.cleanup();
  }

  private cleanup() {
    this.aborted = true;
    if (this.rejectTimer) {
      clearTimeout(this.rejectTimer);
      this.rejectTimer = null;
    }
    try {
      this.channel?.close();
    } catch {
      /* yoksay */
    }
    try {
      this.pc?.close();
    } catch {
      /* yoksay */
    }
    this.channel = null;
    this.pc = null;
    this.fileToSend = null;
    this.incomingOffer = null;
    this.pendingCandidates = [];
    this.remoteReady = false;
    this.answered = false;
  }
}

export const rtcManager = new RtcTransferManager();
