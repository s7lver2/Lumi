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

// Crea el panel y sus controles. Se llama una vez desde InitializeWizard()
// en cada script concreto, con la lista de nombres de página de esa app.
procedure CrearPanelLateral(NombresPasos: TArrayOfString);
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
  marca.Caption := '* Lumi';
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

  // Empuja el contenido normal del wizard (las páginas de Inno) a la
  // derecha del panel — sin esto, el panel se dibujaría ENCIMA del wizard
  // en vez de al lado.
  WizardForm.MainPanel.Left := PanelAncho;
  WizardForm.MainPanel.Width := WizardForm.ClientWidth - PanelAncho;
  if Assigned(WizardForm.WizardBitmapImage) then
    WizardForm.WizardBitmapImage.Visible := False;
  if Assigned(WizardForm.WizardSmallBitmapImage) then
    WizardForm.WizardSmallBitmapImage.Visible := False;
end;

// Se llama desde CurPageChanged en cada script concreto: el paso `activo`
// se pinta en ColorDrawFg (estado "en curso" de DESIGN.md), los anteriores
// en ColorMuted, los siguientes en ColorSubtle.
procedure ActualizarPasoActivo(PasoActivo: Integer);
var
  i: Integer;
begin
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
