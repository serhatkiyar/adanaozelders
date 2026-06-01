import { useState } from "react";
import {
  useAddBookingPrivateNote,
  useDeleteBookingPrivateNote,
} from "@/hooks/useBookings";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BookingPrivateNoteOut } from "@/types";

interface Props {
  bookingId: number;
  notes: BookingPrivateNoteOut[];
  /** Başlık + gizlilik rozetini göster (varsayılan true). */
  showHeading?: boolean;
}

export function BookingPrivateNotesPanel({
  bookingId,
  notes,
  showHeading = true,
}: Props) {
  const [privateNoteBody, setPrivateNoteBody] = useState("");
  const addPrivateNote = useAddBookingPrivateNote();
  const delPrivateNote = useDeleteBookingPrivateNote();

  const handleAddPrivateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateNoteBody.trim()) return;
    addPrivateNote.mutate(
      { id: bookingId, body: privateNoteBody.trim() },
      {
        onSuccess: () => setPrivateNoteBody(""),
        onError: (err) => toast.error(getErrorMessage(err, "Not gönderilemedi.")),
      }
    );
  };

  return (
    <div>
      {showHeading && (
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Notlar
          </h2>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            Sadece siz görebilirsiniz
          </span>
        </div>
      )}

      <div className={showHeading ? "mt-4 space-y-4" : "space-y-4"}>
        {notes && notes.length > 0 ? (
          <div className="space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="relative rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/40"
              >
                <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                  {note.body}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    {new Date(note.created_at).toLocaleDateString()}{" "}
                    {new Date(note.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    onClick={() =>
                      delPrivateNote.mutate({ id: bookingId, noteId: note.id })
                    }
                    disabled={delPrivateNote.isPending}
                    className="text-xs font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"
                  >
                    Sil
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Henüz bir not eklemediniz.
          </p>
        )}

        <form
          onSubmit={handleAddPrivateNote}
          className="flex gap-2 border-t border-slate-100 pt-2 dark:border-slate-700"
        >
          <textarea
            rows={2}
            placeholder="Notunuz"
            value={privateNoteBody}
            onChange={(e) => setPrivateNoteBody(e.target.value)}
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={addPrivateNote.isPending || !privateNoteBody.trim()}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Kaydet
          </button>
        </form>
      </div>
    </div>
  );
}
