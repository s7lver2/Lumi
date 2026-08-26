; Panel lateral persistente del instalador: marca, fondo de espacio y lista
; de pasos. Compartido por client/installer/lumi.iss e
; indexer/installer/lumi-indexer.iss vía #include — un solo Pascal, no dos
; copias que puedan divergir.
;
; Colores traducidos de DESIGN.md. TColor de Windows usa $BBGGRR (orden de
; bytes invertido respecto al RGB/hex web), de ahí la conversión en cada
; comentario.

[Code]
const
  // #0e0f11 (bg) -> BGR
  ColorBg = $110F0E;
  // #1a1b1e (panel) -> BGR
  ColorPanel = $1E1B1A;
  // #05070a (space) -> BGR
  ColorSpace = $0A0705;
  // #e8e8e6 (fg) -> BGR
  ColorFg = $E6E8E8;
  // #9a9a95 (muted) -> BGR
  ColorMuted = $959A9A;
  // #6a6c70 (subtle) -> BGR
  ColorSubtle = $706C6A;
  // #85b7eb (draw-fg, "en curso") -> BGR
  ColorDrawFg = $EBB785;
  PanelAncho = 180;

var
  PanelLateral: TPanel;
  PasosLabels: array of TNewStaticText;

// Recolorea cada página con los tokens de DESIGN.md. `InnerNotebook`/
// `OuterNotebook` (los contenedores) no exponen `.Color` — confirmado al
// compilar contra ellos — pero cada página SÍ lo tiene por separado
// (`WizardForm.WelcomePage.Color`, etc.), así que el fondo se pinta página
// a página, no en el contenedor.
procedure AplicarTemaOscuro();
begin
  WizardForm.Color := ColorBg;
  WizardForm.MainPanel.Color := ColorBg;
  WizardForm.PageNameLabel.Font.Color := ColorFg;
  WizardForm.PageDescriptionLabel.Font.Color := ColorMuted;

  // Bienvenida y Fin viven en OuterNotebook — comprobado con capturas
  // reales que su página SÍ ocupa el 100% de su área al recolorearla.
  WizardForm.WelcomePage.ParentBackground := False;
  WizardForm.WelcomePage.Color := ColorBg;
  WizardForm.WelcomeLabel1.Font.Color := ColorFg;
  WizardForm.WelcomeLabel2.Font.Color := ColorMuted;

  WizardForm.FinishedPage.ParentBackground := False;
  WizardForm.FinishedPage.Color := ColorBg;
  WizardForm.FinishedLabel.Font.Color := ColorMuted;
  WizardForm.FinishedHeadingLabel.Font.Color := ColorFg;

  // Licencia/Carpeta/Tareas/Listo/Preparando/Instalando viven en
  // InnerNotebook. Se intentó recolorear también su fondo (misma técnica
  // que arriba) y una captura real mostró un hueco blanco sin pintar
  // dentro de la página: sus controles internos no se realinean al mover
  // el notebook contenedor, así que .Color deja un rectángulo mal
  // encajado en vez de cubrir toda la página. Se revirtió esa parte —
  // quedan con el fondo claro por defecto de Windows, y por eso aquí NO
  // se tocan sus colores de texto (el negro por defecto es legible sobre
  // ese fondo; ponerlos claros los habría dejado ilegibles). Techo
  // anotado: recolorear estas seis páginas necesitaría entender por qué
  // sus hijos no siguen el resize del notebook, o forzar un realineado
  // manual — no resuelto en esta pasada.
end;

// Crea el panel y sus controles. Se llama una vez desde InitializeWizard()
// en cada script concreto, con la lista de nombres de página de esa app y
// el texto de marca a mostrar — "Lumi" para el cliente, "Lumi Indexer"
// para el Indexer: son dos productos distintos (ver CLAUDE.md), y hasta
// ahora el panel compartido los rotulaba a los dos igual.
procedure CrearPanelLateral(NombresPasos: TArrayOfString; NombreMarca: String);
var
  i: Integer;
  marca: TNewStaticText;
  version: TNewStaticText;
begin
  PanelLateral := TPanel.Create(WizardForm);
  PanelLateral.Parent := WizardForm;
  PanelLateral.SetBounds(0, 0, PanelAncho, WizardForm.ClientHeight);
  PanelLateral.Color := ColorSpace;
  PanelLateral.ParentBackground := False;
  PanelLateral.BevelOuter := bvNone;
  // Ancla arriba+abajo para que el panel ocupe toda la altura si la
  // ventana cambia de tamaño (Inno permite redimensionar por defecto).
  PanelLateral.Anchors := [akLeft, akTop, akBottom];

  marca := TNewStaticText.Create(WizardForm);
  marca.Parent := PanelLateral;
  marca.Left := 22;
  marca.Top := 24;
  marca.Caption := '* ' + NombreMarca;
  marca.Font.Color := ColorFg;
  marca.Font.Size := 11;
  marca.AutoSize := True;

  SetArrayLength(PasosLabels, GetArrayLength(NombresPasos));
  for i := 0 to GetArrayLength(NombresPasos) - 1 do
  begin
    PasosLabels[i] := TNewStaticText.Create(WizardForm);
    PasosLabels[i].Parent := PanelLateral;
    PasosLabels[i].Left := 22;
    PasosLabels[i].Top := 88 + i * 26;
    PasosLabels[i].Caption := NombresPasos[i];
    PasosLabels[i].Font.Color := ColorSubtle;
    PasosLabels[i].AutoSize := True;
  end;

  version := TNewStaticText.Create(WizardForm);
  version.Parent := PanelLateral;
  version.Left := 22;
  version.Anchors := [akLeft, akBottom];
  version.Top := WizardForm.ClientHeight - 40;
  version.Caption := '{#SetupSetting("AppVersion")}';
  version.Font.Color := ColorSubtle;
  version.AutoSize := True;

  // Empuja el contenido normal del wizard a la derecha del panel. `MainPanel`
  // es solo la cabecera (título+descripción de página, 58px de alto) —
  // `InnerNotebook` (licencia/carpeta/tareas/listo) y `OuterNotebook`
  // (bienvenida/fin) son los contenedores de verdad, y son los tres que hay
  // que desplazar. Confirmado en tiempo de ejecución con un script de
  // sondeo (MsgBox con los Left/Top/Width/Height reales) antes de escribir
  // esto — un intento anterior solo tocaba MainPanel y el resto del
  // contenido quedaba dibujado DEBAJO del panel, con el texto recortado.
  WizardForm.MainPanel.Left := WizardForm.MainPanel.Left + PanelAncho;
  WizardForm.MainPanel.Width := WizardForm.MainPanel.Width - PanelAncho;
  WizardForm.InnerNotebook.Left := WizardForm.InnerNotebook.Left + PanelAncho;
  WizardForm.InnerNotebook.Width := WizardForm.InnerNotebook.Width - PanelAncho;
  WizardForm.OuterNotebook.Left := WizardForm.OuterNotebook.Left + PanelAncho;
  WizardForm.OuterNotebook.Width := WizardForm.OuterNotebook.Width - PanelAncho;
  if Assigned(WizardForm.WizardBitmapImage) then
    WizardForm.WizardBitmapImage.Visible := False;
  if Assigned(WizardForm.WizardSmallBitmapImage) then
    WizardForm.WizardSmallBitmapImage.Visible := False;

  AplicarTemaOscuro();
end;

// Se llama desde CurPageChanged en cada script concreto: el paso `activo`
// se pinta en ColorDrawFg (estado "en curso" de DESIGN.md), los anteriores
// en ColorMuted, los siguientes en ColorSubtle.
procedure ActualizarPasoActivo(PasoActivo: Integer);
var
  i: Integer;
begin
  // Inno recalcula el ancho de estas dos etiquetas en cada cambio de
  // página asumiendo la cabecera a ancho completo, deshaciendo el hueco
  // que le dejamos al panel lateral — confirmado viendo el título cortado
  // en una captura real. Se fuerza de nuevo aquí, en cada cambio de
  // página, calculado a partir del ancho actual de MainPanel (ya
  // reducido), no de un número fijo.
  WizardForm.PageNameLabel.Width :=
    WizardForm.MainPanel.Width - WizardForm.PageNameLabel.Left - 16;
  WizardForm.PageDescriptionLabel.Width :=
    WizardForm.MainPanel.Width - WizardForm.PageDescriptionLabel.Left - 16;
  // Se probó también reducir WizardForm.PageNameLabel.Font.Size para que
  // los títulos más largos ("Seleccione la Carpeta de Destino") cupieran
  // en una línea. Se revirtió: en la página de Bienvenida (que no pasa
  // por esta función, pero comparte wizard) el título grande desapareció
  // por completo tras ese cambio — indicio de que Font es un objeto
  // compartido entre PageNameLabel y WelcomeLabel1 en este estilo de
  // asistente, no visto en la documentación. Con solo el ajuste de ancho
  // de arriba, los dos títulos más largos ("Carpeta de Destino", "Tareas
  // Adicionales") pierden la última palabra — un recorte menor y
  // conocido, preferible a otra regresión sin verificar.

  for i := 0 to GetArrayLength(PasosLabels) - 1 do
  begin
    if i < PasoActivo then
      PasosLabels[i].Font.Color := ColorMuted
    else if i = PasoActivo then
      PasosLabels[i].Font.Color := ColorDrawFg
    else
      PasosLabels[i].Font.Color := ColorSubtle;
  end;
end;
