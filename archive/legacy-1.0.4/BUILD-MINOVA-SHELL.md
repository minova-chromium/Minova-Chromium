# Minova shell build generator

`build-minova-shell.js` creates a fresh staging directory, copies the existing Minova UI/assets without modifying the source, generates the Electron bootstrap coordinator, guarded Chrome data importer, Manifest V3 controller, and elevated electron-builder NSIS customization, then optionally compiles the installer.

Production build:

```powershell
node .\build-minova-shell.js `
  --msi "C:\Installers\GoogleChromeStandaloneEnterprise64.msi" `
  --extension-id "abcdefghijklmnopabcdefghijklmnop"
```

Generate a reviewable stage without downloading dependencies or compiling:

```powershell
node .\build-minova-shell.js --prepare-only
```

Use `node .\build-minova-shell.js --help` for all options. The production command requires a locally supplied, Authenticode-valid Google-signed Enterprise MSI and the ID assigned to the published Chrome Web Store extension.

