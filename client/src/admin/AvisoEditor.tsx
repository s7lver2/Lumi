import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { usePopover } from "../ui/TitleBar";

const FUENTES = [
  { label: "Sans", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
];
// `#85b7eb` (el azul de `draw-fg`, "dibujo en mapa, en curso" según
// DESIGN.md) no pintaba nada aquí — es un color con un significado propio
// prestado sin motivo, y además el único saturado/frío entre cuatro tonos
// neutros/cálidos. Se sustituye por `#9a9a95` (token `muted` ya existente
// en la paleta) para tener un cuarto tono realmente neutro en vez de
// inventar un hex nuevo (#81).
const COLORES = ["#e8e8e6", "#9a9a95", "#efb968", "#e88f8f"];
const EMOJIS = ["🔔", "⚠️", "🔧", "📦", "☁️", "🚀", "🎉", "✅", "📅", "💬", "🛡️", "⭐"];

const DOC_VACIO = { type: "doc", content: [{ type: "paragraph" }] };

/** Un solo componente para escribir y para leer: en modo lectura
 *  (`editable={false}`) es exactamente el mismo esquema de Tiptap sin la
 *  barra, nunca un `dangerouslySetInnerHTML` aparte — así lo que un
 *  administrador escribe no puede convertirse en markup arbitrario en la
 *  pantalla de otra persona. */
export function AvisoEditor({ contenido, onChange, editable = true, compacto = false }: {
  contenido: unknown; onChange?: (json: unknown) => void; editable?: boolean;
  /** Una línea, truncada con "…" — para la vista previa y el selector de
   *  icono, donde varias instancias de lectura se muestran a la vez. */
  compacto?: boolean;
}) {
  // `usePopover` (la misma pieza que ya cierra la campana al clicar fuera o
  // con Escape) — sin esto el picker se quedaba abierto para siempre, que es
  // parte de por qué se sentía roto.
  const [emojiAbierto, setEmojiAbierto, emojiBox] = usePopover();
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, FontFamily],
    content: (contenido ?? DOC_VACIO) as never,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });

  // `useEditor` solo aplica `content` al crear el editor, no en cada
  // re-render — sin esto, las instancias de solo lectura (vista previa,
  // selector de icono) se quedaban congeladas con el primer contenido y
  // nunca reflejaban lo que se seguía escribiendo, que es por lo que ni el
  // color ni la negrita ni la fuente parecían "no renderizarse": en
  // realidad la vista previa ni siquiera estaba mostrando el documento
  // actual. Solo aplica en modo lectura — el editor editable ya gestiona su
  // propio contenido con cada pulsación.
  useEffect(() => {
    if (!editor || editable) return;
    const actual = JSON.stringify(editor.getJSON());
    const nuevo = JSON.stringify(contenido ?? DOC_VACIO);
    if (actual !== nuevo) editor.commands.setContent((contenido ?? DOC_VACIO) as never, { emitUpdate: false });
  }, [contenido, editor, editable]);

  if (!editor) return null;

  if (!editable) {
    return (
      <div className={compacto
        ? "truncate text-[12px] text-fg [&_p]:m-0 [&_p]:inline"
        : "aviso-lectura text-[12px] leading-[1.55] text-fg"}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    // Sin `overflow-hidden` aquí: recortaba el picker de emoji, que es
    // descendiente de este contenedor aunque se posicione fuera de sus
    // bordes — el bug real detrás de que se viera "roto". El redondeo de la
    // barra se resuelve con sus propias esquinas, no recortando al padre.
    <div className="rounded-card border border-border bg-panel">
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-[11px] border-b border-border bg-elevated px-2 py-1.5">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
          className={`jg-press grid h-6 w-6 place-items-center rounded-md text-[12px] font-bold ${
            editor.isActive("bold") ? "bg-white/[.09] text-fg" : "text-muted"}`}>B</button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`jg-press grid h-6 w-6 place-items-center rounded-md text-[12px] italic ${
            editor.isActive("italic") ? "bg-white/[.09] text-fg" : "text-muted"}`}>i</button>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <div className="flex gap-1">
          {COLORES.map((c) => (
            <button key={c} type="button" onClick={() => editor.chain().focus().setColor(c).run()}
              className="jg-press h-[15px] w-[15px] rounded border border-white/15" style={{ background: c }} />
          ))}
        </div>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <select onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          defaultValue="" className="h-6 rounded-md border border-border bg-panel px-1.5 text-[10.5px] text-fg">
          {FUENTES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <span className="mx-1.5 h-4 w-px bg-border" />
        <div ref={emojiBox} className="relative">
          <button type="button" onClick={() => setEmojiAbierto(!emojiAbierto)}
            className="jg-press grid h-6 w-6 place-items-center rounded-md text-[13px] text-muted hover:text-fg">🙂</button>
          {emojiAbierto && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-30 grid w-[196px] grid-cols-6 gap-1
              rounded-lg border border-white/15 bg-[rgba(20,22,26,.98)] p-2 shadow-lg shadow-black/50"
              style={{ animation: "jg-popup-scale-in 160ms cubic-bezier(.2,.85,.35,1) both" }}>
              {EMOJIS.map((e) => (
                <button key={e} type="button"
                  onClick={() => { editor.chain().focus().insertContent(e).run(); setEmojiAbierto(false); }}
                  className="jg-press grid h-7 w-7 place-items-center rounded-md text-[15px] hover:bg-white/[.08]">{e}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <EditorContent editor={editor} className="px-3 py-2.5 text-[12px] text-fg" />
    </div>
  );
}
