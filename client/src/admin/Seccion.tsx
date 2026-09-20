/** La cabecera común de una sección mudada. Existe para que las cinco vistas
 *  que se mudan no tengan que aprender a pintar su propio título.
 *
 *  Vive en su propio fichero (y no dentro de `AdminPanel.tsx`, donde nació)
 *  porque cada vista mudada la importaba de `AdminPanel.tsx` -- un ciclo
 *  `AdminPanel -> vista -> AdminPanel` que impedía a Rolldown separar el
 *  panel entero (y `AvisoEditor` con él) del chunk de arranque pese al
 *  `React.lazy` de `App.tsx` (C2): con la importación circular, el bundler
 *  no puede aislar el subárbol en su propio chunk y todo terminaba de
 *  vuelta en `index-*.js`. */
export function Seccion({ titulo, grupo, accion, children }: {
  titulo: React.ReactNode; grupo: string; accion?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">{grupo}</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">{titulo}</h2>
        {accion && <span className="ml-auto pb-px">{accion}</span>}
      </div>
      <div className="mt-[19px]">{children}</div>
    </div>
  );
}
