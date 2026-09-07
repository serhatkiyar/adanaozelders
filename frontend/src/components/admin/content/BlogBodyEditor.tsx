import { useCallback, useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";

import { Button } from "@/components/admin/ui";

/**
 * Blog gövdesi için TipTap editörü.
 *
 * Çıktı HTML'dir ve SUNUCUDA sanitize edilir (`services/blog_service.py`
 * allowlist'i) — buradaki uzantı kümesi o allowlist'in aynasıdır; burada
 * üretilemeyen ama allowlist'te olan etiketler (img, table) medya/ileri
 * sürüm işidir. Paket yalnız admin chunk'ında yaşar (sayfa lazy).
 */

const BUTON =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ";
const BUTON_AKTIF = "bg-slate-900 text-white hover:bg-slate-900 hover:text-white ";

function ToolbarButton({
  editor,
  label,
  title,
  aktif,
  onClick,
  disabled,
}: {
  editor: Editor;
  label: React.ReactNode;
  title: string;
  aktif?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  void editor;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={aktif}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`${BUTON} ${aktif ? BUTON_AKTIF : ""} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

function LinkAlani({ editor, onKapat }: { editor: Editor; onKapat: () => void }) {
  const [url, setUrl] = useState<string>(editor.getAttributes("link").href ?? "");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const temiz = url.trim();
        if (temiz) {
          editor.chain().focus().extendMarkRange("link").setLink({ href: temiz }).run();
        } else {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
        }
        onKapat();
      }}
    >
      <input
        autoFocus
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        aria-label="Bağlantı adresi"
        className="h-8 w-56 rounded-lg border border-slate-300 bg-white px-2 text-[13px] text-slate-900 outline-none focus:border-slate-500 "
      />
      <Button type="submit" size="sm" variant="secondary">
        Uygula
      </Button>
      <Button size="sm" variant="ghost" onClick={onKapat}>
        Vazgeç
      </Button>
    </form>
  );
}

export function BlogBodyEditor({
  value,
  onChange,
  disabled = false,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  /** Sunucudan gelen (sanitize edilmiş) HTML. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  /**
   * Yazma yüzeyine (contentEditable) inen `id` ve `aria-*`.
   *
   * `Form.Control` içinde kullanılabilmesi için ZORUNLU: o katman kimliği
   * çocuğuna verir ve mount'tan sonra DOM'da GERÇEKTEN olup olmadığını
   * ÖLÇER. İletmeyen bir bileşen etiket bağını sessizce kurmuyordu ve
   * kontrol ekran okuyucuya ADSIZ görünüyordu (İP-A3c'nin kapattığı üç
   * yazımdan üçüncüsü). Blog sayfası bunları vermez; orada etiket görsel
   * bir başlıktır ve `role="textbox"` + `aria-label` yeter.
   */
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [linkAcik, setLinkAcik] = useState(false);

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Allowlist H2-H4 kabul eder; H1 sayfa başlığına aittir.
        heading: { levels: [2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
      // Hizalama style="text-align: …" olarak yazılır; sunucu sanitizasyonu
      // yalnız bu style değerini geçirir (services/blog_service.py).
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value,
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
    editorProps: {
      attributes: {
        // Yazma yüzeyi bir metin kutusudur; rol ve kimlik OLMADAN ekran
        // okuyucu onu yalnız "düzenlenebilir bölge" diye duyurur.
        role: "textbox",
        "aria-multiline": "true",
        ...(id ? { id } : {}),
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
        ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
        class:
          "min-h-72 px-4 py-3 text-[15px] leading-relaxed text-slate-800 outline-none " +
          "[&_p]:mt-3 [&_p:first-child]:mt-0 " +
          "[&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold " +
          "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 " +
          "[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic " +
          "[&_pre]:mt-4 [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100 " +
          "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_pre_code]:bg-transparent " +
          "[&_a]:text-blue-700 [&_a]:underline [&_hr]:my-6",
      },
    },
  });

  // Dışarıdan yeni değer geldiğinde (kayıt yüklendi) editörü eşitle.
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== value) {
      editor.commands.setContent(value || "", false);
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const linkToggle = useCallback(() => setLinkAcik((v) => !v), []);

  if (!editor) return <div className="h-80 animate-pulse rounded-xl bg-slate-100 " />;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white ">
      <div
        role="toolbar"
        aria-label="Metin biçimlendirme"
        className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1.5 "
      >
        <ToolbarButton editor={editor} title="Geri al" label="↺" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <ToolbarButton editor={editor} title="Yinele" label="↻" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
        <span className="mx-1 h-5 w-px bg-slate-200 " aria-hidden />
        <ToolbarButton editor={editor} title="Başlık 2" label="H2" aktif={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton editor={editor} title="Başlık 3" label="H3" aktif={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className="mx-1 h-5 w-px bg-slate-200 " aria-hidden />
        <ToolbarButton editor={editor} title="Kalın" label={<strong>K</strong>} aktif={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton editor={editor} title="İtalik" label={<em>İ</em>} aktif={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton editor={editor} title="Üstü çizili" label={<s>S</s>} aktif={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <span className="mx-1 h-5 w-px bg-slate-200 " aria-hidden />
        <ToolbarButton editor={editor} title="Sola hizala" label="⇤" aktif={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
        <ToolbarButton editor={editor} title="Ortala" label="↔" aktif={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
        <ToolbarButton editor={editor} title="Sağa hizala" label="⇥" aktif={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
        <span className="mx-1 h-5 w-px bg-slate-200 " aria-hidden />
        <ToolbarButton editor={editor} title="Madde listesi" label="•—" aktif={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton editor={editor} title="Numaralı liste" label="1—" aktif={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton editor={editor} title="Alıntı" label="❝" aktif={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolbarButton editor={editor} title="Kod bloğu" label="</>" aktif={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
        <ToolbarButton editor={editor} title="Yatay çizgi" label="-" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <span className="mx-1 h-5 w-px bg-slate-200 " aria-hidden />
        {linkAcik ? (
          <LinkAlani editor={editor} onKapat={() => setLinkAcik(false)} />
        ) : (
          <ToolbarButton editor={editor} title="Bağlantı" label="⇗" aktif={editor.isActive("link")} onClick={linkToggle} />
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
