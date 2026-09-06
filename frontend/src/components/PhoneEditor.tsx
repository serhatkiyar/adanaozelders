import { FormEvent, useId, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { useRequestPhoneOtp, useVerifyPhone } from "@/hooks/useProfile";
import { toast } from "@/store/toastStore";

/**
 * İki fazlı telefon doğrulaması: numara → SMS kodu.
 *
 * `Settings.tsx` içinde doğmuştu; ilan sihirbazının telefon adımı aynı akışı
 * istediği için buraya taşındı. İki kopya tutulmadı — OTP akışının iki ayrı
 * yerde ayrışması, kullanıcının kod isteyip doğrulayamadığı sessiz bir arıza
 * üretirdi.
 */

// min-h-[44px]: dokunma hedefi eşiği. Ölçüldü — `py-2.5` 42px veriyordu.
const inputCls =
  "min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 ";

const fieldLabelCls = "mb-1.5 block text-xs font-medium text-slate-500 ";

export function PhoneEditor({
  initialPhone,
  onDone,
}: {
  initialPhone: string;
  onDone: () => void;
}) {
  const uid = useId();
  const requestOtp = useRequestPhoneOtp();
  const verify = useVerifyPhone();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(initialPhone);
  const [masked, setMasked] = useState("");
  const [code, setCode] = useState("");

  const sendCode = () => {
    requestOtp.mutate(phone.trim(), {
      onSuccess: (res) => {
        setMasked(res.phone_masked);
        setStep("code");
        setCode("");
        toast.success("Doğrulama kodu SMS ile gönderildi.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Kod gönderilemedi.")),
    });
  };

  if (step === "phone") {
    return (
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (phone.trim().length < 10) {
            toast.error("Geçerli bir cep numarası gir.");
            return;
          }
          sendCode();
        }}
      >
        <label htmlFor={`${uid}-cep-telefonu`} className={fieldLabelCls}>Cep telefonu</label>
        <input id={`${uid}-cep-telefonu`}
          type="tel"
          inputMode="tel"
          className={inputCls}
          value={phone}
          autoFocus
          placeholder="0532 123 45 67"
          onChange={(e) => setPhone(e.target.value)}
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={requestOtp.isPending}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 "
          >
            {requestOtp.isPending ? "Gönderiliyor…" : "Kod gönder"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700 "
          >
            İptal
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (code.trim().length < 4) {
          toast.error("Kodu gir.");
          return;
        }
        verify.mutate(code.trim(), {
          onSuccess: () => {
            toast.success("Telefon numaran doğrulandı.");
            onDone();
          },
          onError: (err) => toast.error(getErrorMessage(err, "Doğrulama başarısız.")),
        });
      }}
    >
      <p className="mb-3 text-sm text-slate-500 ">
        <span className="font-medium text-slate-700 ">{masked}</span>{" "}
        numarasına gönderilen 6 haneli kodu gir.
      </p>
      <label htmlFor={`${uid}-sms-kodu`} className={fieldLabelCls}>SMS kodu</label>
      <input id={`${uid}-sms-kodu`}
        type="text"
        inputMode="numeric"
        maxLength={6}
        className={inputCls}
        value={code}
        autoFocus
        placeholder="123456"
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={verify.isPending}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 "
        >
          {verify.isPending ? "Doğrulanıyor…" : "Doğrula"}
        </button>
        <button
          type="button"
          onClick={sendCode}
          disabled={requestOtp.isPending}
          className="inline-flex min-h-[44px] items-center text-sm font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700 disabled:opacity-60 "
        >
          Kodu tekrar gönder
        </button>
        <button
          type="button"
          onClick={() => setStep("phone")}
          className="inline-flex min-h-[44px] items-center text-sm font-medium text-slate-500 underline underline-offset-2 transition hover:text-slate-700 "
        >
          Numarayı değiştir
        </button>
      </div>
    </form>
  );
}
