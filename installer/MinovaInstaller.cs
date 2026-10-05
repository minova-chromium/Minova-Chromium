using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Minova.Installer
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Arguments options = Arguments.Parse(args);
#if UNINSTALLER
            options.Uninstall = true;
#endif
            if (options.Silent)
            {
                try
                {
                    if (options.Uninstall)
                    {
                        InstallerEngine.Uninstall(options.InstallDirectory, options.TestMode, null);
                    }
                    else
                    {
                        InstallerEngine.Install(
                            options.InstallDirectory,
                            options.DesktopShortcut,
                            options.StartMenuShortcut,
                            options.TestMode,
                            null);
                    }
                    Environment.ExitCode = 0;
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error);
                    WriteInstallerLog(error);
                    Environment.ExitCode = 1;
                }
                return;
            }

            Application.Run(new InstallerForm(options));
        }

        private static void WriteInstallerLog(Exception error)
        {
            try
            {
                string logPath = Path.Combine(Path.GetTempPath(), "MinovaInstaller.log");
                File.AppendAllText(
                    logPath,
                    DateTime.UtcNow.ToString("o")
                    + " "
                    + error
                    + Environment.NewLine
                    + Environment.NewLine);
            }
            catch
            {
                // Logging must never replace the original installer failure.
            }
        }
    }

    internal sealed class Arguments
    {
        internal bool Silent;
        internal bool Uninstall;
        internal bool TestMode;
        internal bool DesktopShortcut = true;
        internal bool StartMenuShortcut = true;
        internal string InstallDirectory = InstallerEngine.FindInstallDirectory();

        internal static Arguments Parse(string[] args)
        {
            Arguments result = new Arguments();
            foreach (string argument in args)
            {
                if (String.Equals(argument, "/silent", StringComparison.OrdinalIgnoreCase))
                {
                    result.Silent = true;
                }
                else if (String.Equals(argument, "/uninstall", StringComparison.OrdinalIgnoreCase))
                {
                    result.Uninstall = true;
                }
                else if (String.Equals(argument, "/test", StringComparison.OrdinalIgnoreCase))
                {
                    result.TestMode = true;
                    result.DesktopShortcut = false;
                    result.StartMenuShortcut = false;
                }
                else if (String.Equals(argument, "/noDesktopShortcut", StringComparison.OrdinalIgnoreCase))
                {
                    result.DesktopShortcut = false;
                }
                else if (String.Equals(argument, "/noStartMenuShortcut", StringComparison.OrdinalIgnoreCase))
                {
                    result.StartMenuShortcut = false;
                }
                else if (argument.StartsWith("/installDir=", StringComparison.OrdinalIgnoreCase))
                {
                    result.InstallDirectory = argument.Substring("/installDir=".Length).Trim('"');
                }
            }
            return result;
        }
    }

    internal sealed class ReleaseInfo
    {
        internal string Version = "1.0.0";
        internal long PayloadBytes;
        internal string PayloadSha256 = "";

        internal static ReleaseInfo Load()
        {
            ReleaseInfo result = new ReleaseInfo();
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.release"))
            {
                if (stream == null)
                {
                    return result;
                }
                using (StreamReader reader = new StreamReader(stream))
                {
                    while (!reader.EndOfStream)
                    {
                        string line = reader.ReadLine() ?? "";
                        int separator = line.IndexOf('=');
                        if (separator <= 0)
                        {
                            continue;
                        }
                        string key = line.Substring(0, separator).Trim();
                        string value = line.Substring(separator + 1).Trim();
                        if (key == "version")
                        {
                            result.Version = value;
                        }
                        else if (key == "payloadBytes")
                        {
                            long.TryParse(value, out result.PayloadBytes);
                        }
                        else if (key == "payloadSha256")
                        {
                            result.PayloadSha256 = value;
                        }
                    }
                }
            }
            return result;
        }
    }

    internal sealed class InstallProgress
    {
        internal readonly string Message;
        internal readonly int Percentage;

        internal InstallProgress(string message, int percentage)
        {
            Message = message;
            Percentage = Math.Max(0, Math.Min(100, percentage));
        }
    }

    internal static class InstallerEngine
    {
        internal const string ProductName = "Minova";
        private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Minova";
        private const string InstallMarkerName = ".minova-install-root";
        private const string InstallMarkerValue = "com.minova.browser";
        private static readonly ReleaseInfo Release = ReleaseInfo.Load();

        internal static ReleaseInfo CurrentRelease
        {
            get { return Release; }
        }

        internal static string FindInstallDirectory()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                string existing = key == null ? null : key.GetValue("InstallLocation") as string;
                if (!String.IsNullOrWhiteSpace(existing))
                {
                    return existing;
                }
            }
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "Minova");
        }

        internal static string GetInstalledVersion()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                return key == null ? "" : Convert.ToString(key.GetValue("DisplayVersion"));
            }
        }

        internal static void Install(
            string installDirectory,
            bool desktopShortcut,
            bool startMenuShortcut,
            bool testMode,
            Action<InstallProgress> report)
        {
            string root = NormalizeInstallDirectory(installDirectory);
            string versionFolderName = "app-" + Release.Version;
            string versionDirectory = Path.Combine(root, versionFolderName);
            string stagingDirectory = Path.Combine(root, ".installing-" + Guid.NewGuid().ToString("N"));
            string backupDirectory = versionDirectory + ".backup-" + Guid.NewGuid().ToString("N");
            bool movedExisting = false;

            Report(report, "Checking available space", 3);
            EnsureDiskSpace(root, Release.PayloadBytes);
            EnsureSafeInstallRoot(root);
            Directory.CreateDirectory(root);
            WriteTextAtomically(Path.Combine(root, InstallMarkerName), InstallMarkerValue + Environment.NewLine);

            try
            {
                Report(report, "Preparing Minova " + Release.Version, 7);
                ExtractPayload(stagingDirectory, report);
                ValidateRuntime(stagingDirectory);

                if (Directory.Exists(versionDirectory))
                {
                    Report(report, "Preparing a safe repair", 82);
                    Directory.Move(versionDirectory, backupDirectory);
                    movedExisting = true;
                }

                Directory.Move(stagingDirectory, versionDirectory);
                WriteTextAtomically(Path.Combine(root, "current-version.txt"), Release.Version + Environment.NewLine);
                WriteTextAtomically(
                    Path.Combine(root, "release.properties"),
                    "version=" + Release.Version + Environment.NewLine
                    + "payloadSha256=" + Release.PayloadSha256 + Environment.NewLine);

                if (!testMode)
                {
                    Report(report, "Creating Windows shortcuts", 88);
                    ExtractEmbeddedFile("minova.uninstaller", Path.Combine(root, "Uninstall Minova.exe"));
                    UpdateShortcuts(root, versionDirectory, desktopShortcut, startMenuShortcut);
                    WriteUninstallRegistration(root, versionDirectory);
                    RemoveObsoleteVersions(root, versionDirectory, backupDirectory);
                }

                TryDeleteDirectory(backupDirectory);
                Report(report, "Minova is ready", 100);
            }
            catch
            {
                TryDeleteDirectory(stagingDirectory);
                if (movedExisting && !Directory.Exists(versionDirectory) && Directory.Exists(backupDirectory))
                {
                    Directory.Move(backupDirectory, versionDirectory);
                }
                throw;
            }
        }

        internal static void Uninstall(string installDirectory, bool testMode, Action<InstallProgress> report)
        {
            string root = NormalizeInstallDirectory(installDirectory);
            if (!IsManagedInstallRoot(root))
            {
                throw new InvalidOperationException("This folder is not a managed Minova installation.");
            }

            Report(report, "Removing Minova application files", 20);
            foreach (string directory in Directory.Exists(root)
                ? Directory.GetDirectories(root, "app-*", SearchOption.TopDirectoryOnly)
                : new string[0])
            {
                DeleteDirectoryOrThrow(directory);
            }

            foreach (string fileName in new[]
            {
                "current-version.txt",
                "release.properties",
                InstallMarkerName
            })
            {
                DeleteFileOrThrow(Path.Combine(root, fileName));
            }

            Report(report, "Removing shortcuts", 75);
            if (!testMode)
            {
                RemoveShortcuts();
                Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            }

            Report(report, "Finishing uninstall", 90);
            if (testMode)
            {
                TryDeleteDirectory(root);
            }
            else
            {
                ScheduleInstallDirectoryRemoval(root);
            }
            Report(report, "Minova was removed", 100);
        }

        internal static void Launch(string installDirectory)
        {
            string executable = Path.Combine(
                NormalizeInstallDirectory(installDirectory),
                "app-" + Release.Version,
                "Minova.exe");
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException("The installed Minova executable was not found.", executable);
            }
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        }

        private static string NormalizeInstallDirectory(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException("Choose an installation folder.");
            }
            string fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(value.Trim()));
            string root = Path.GetPathRoot(fullPath) ?? "";
            if (String.Equals(fullPath.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Minova cannot be installed directly into a drive root.");
            }
            return fullPath.TrimEnd(Path.DirectorySeparatorChar);
        }

        private static void EnsureDiskSpace(string installDirectory, long payloadBytes)
        {
            string pathRoot = Path.GetPathRoot(Path.GetFullPath(installDirectory));
            if (String.IsNullOrWhiteSpace(pathRoot))
            {
                return;
            }
            DriveInfo drive = new DriveInfo(pathRoot);
            long required = Math.Max(payloadBytes + (128L * 1024L * 1024L), payloadBytes * 12L / 10L);
            if (drive.AvailableFreeSpace < required)
            {
                throw new IOException("Minova needs about "
                    + Math.Ceiling(required / 1024d / 1024d)
                    + " MB of free space on this drive.");
            }
        }

        private static void EnsureSafeInstallRoot(string root)
        {
            if (!Directory.Exists(root) || IsManagedInstallRoot(root))
            {
                return;
            }
            using (IEnumerator<string> entries = Directory.EnumerateFileSystemEntries(root).GetEnumerator())
            {
                if (entries.MoveNext())
                {
                    throw new InvalidOperationException(
                        "The selected folder already contains files that are not managed by Minova. "
                        + "Choose an empty folder or create a Minova subfolder.");
                }
            }
        }

        private static bool IsManagedInstallRoot(string root)
        {
            string marker = Path.Combine(root, InstallMarkerName);
            try
            {
                return File.Exists(marker)
                    && String.Equals(File.ReadAllText(marker).Trim(), InstallMarkerValue, StringComparison.Ordinal);
            }
            catch
            {
                return false;
            }
        }

        private static void ExtractPayload(string destination, Action<InstallProgress> report)
        {
            Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.payload");
            if (payload == null)
            {
                throw new InvalidDataException("The Minova application payload is missing.");
            }

            Directory.CreateDirectory(destination);
            string destinationRoot = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
            using (payload)
            using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read, false))
            {
                int totalEntries = Math.Max(1, archive.Entries.Count);
                int completed = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                    if (!target.StartsWith(destinationRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("The installer payload contains an unsafe path.");
                    }

                    if (String.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(target);
                    }
                    else
                    {
                        string parent = Path.GetDirectoryName(target);
                        if (!String.IsNullOrEmpty(parent))
                        {
                            Directory.CreateDirectory(parent);
                        }
                        using (Stream source = entry.Open())
                        using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            source.CopyTo(output);
                        }
                        File.SetLastWriteTime(target, entry.LastWriteTime.LocalDateTime);
                    }

                    completed++;
                    int percentage = 8 + (int)Math.Round(completed * 72d / totalEntries);
                    Report(report, "Installing " + FriendlyEntryName(entry.FullName), percentage);
                }
            }
        }

        private static string FriendlyEntryName(string value)
        {
            string normalized = value.Replace('/', Path.DirectorySeparatorChar).TrimEnd(Path.DirectorySeparatorChar);
            string name = Path.GetFileName(normalized);
            return String.IsNullOrEmpty(name) ? ProductName : name;
        }

        private static void ValidateRuntime(string stagingDirectory)
        {
            string executable = Path.Combine(stagingDirectory, "Minova.exe");
            string appMain = Path.Combine(stagingDirectory, "resources", "app", "src", "app-main.js");
            string runtime = Path.Combine(stagingDirectory, "resources", "minova-runtime.asar");
            if (!File.Exists(executable) || !File.Exists(appMain) || !File.Exists(runtime))
            {
                throw new InvalidDataException("The Minova runtime did not pass installer validation.");
            }
        }

        private static void ExtractEmbeddedFile(string resourceName, string destination)
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (source == null)
                {
                    throw new InvalidDataException("Installer resource " + resourceName + " is missing.");
                }
                using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    source.CopyTo(output);
                }
            }
        }

        private static void UpdateShortcuts(
            string root,
            string versionDirectory,
            bool desktopShortcut,
            bool startMenuShortcut)
        {
            string executable = Path.Combine(versionDirectory, "Minova.exe");
            string desktopLink = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                "Minova.lnk");
            string startMenuFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                "Minova");

            if (desktopShortcut)
            {
                CreateShortcut(desktopLink, executable, versionDirectory, executable, "Minova Browser");
            }
            else
            {
                TryDeleteFile(desktopLink);
            }

            if (startMenuShortcut)
            {
                Directory.CreateDirectory(startMenuFolder);
                CreateShortcut(
                    Path.Combine(startMenuFolder, "Minova.lnk"),
                    executable,
                    versionDirectory,
                    executable,
                    "Minova Browser");
                CreateShortcut(
                    Path.Combine(startMenuFolder, "Uninstall Minova.lnk"),
                    Path.Combine(root, "Uninstall Minova.exe"),
                    root,
                    Path.Combine(root, "Uninstall Minova.exe"),
                    "Uninstall Minova");
            }
            else
            {
                TryDeleteDirectory(startMenuFolder);
            }
        }

        private static void CreateShortcut(
            string shortcutPath,
            string targetPath,
            string workingDirectory,
            string iconPath,
            string description)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("Windows shortcut support is unavailable.");
            }

            object shell = Activator.CreateInstance(shellType);
            object shortcut = null;
            try
            {
                shortcut = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null,
                    shell,
                    new object[] { shortcutPath });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut))
                {
                    Marshal.FinalReleaseComObject(shortcut);
                }
                if (shell != null && Marshal.IsComObject(shell))
                {
                    Marshal.FinalReleaseComObject(shell);
                }
            }
        }

        private static void WriteUninstallRegistration(string root, string versionDirectory)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                if (key == null)
                {
                    throw new InvalidOperationException("Windows could not create Minova uninstall metadata.");
                }
                string uninstaller = Path.Combine(root, "Uninstall Minova.exe");
                key.SetValue("DisplayName", "Minova Browser");
                key.SetValue("DisplayVersion", Release.Version);
                key.SetValue("Publisher", "Minova");
                key.SetValue("InstallLocation", root);
                key.SetValue("DisplayIcon", Path.Combine(versionDirectory, "Minova.exe") + ",0");
                key.SetValue("UninstallString", "\"" + uninstaller + "\" /uninstall");
                key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /uninstall /silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)Math.Min(Int32.MaxValue, Release.PayloadBytes / 1024L), RegistryValueKind.DWord);
            }
        }

        private static void RemoveShortcuts()
        {
            TryDeleteFile(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                "Minova.lnk"));
            TryDeleteDirectory(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                "Minova"));
        }

        private static void RemoveObsoleteVersions(string root, string currentDirectory, string backupDirectory)
        {
            List<DirectoryInfo> versions = new List<DirectoryInfo>();
            foreach (string directory in Directory.GetDirectories(root, "app-*", SearchOption.TopDirectoryOnly))
            {
                if (String.Equals(directory, currentDirectory, StringComparison.OrdinalIgnoreCase)
                    || String.Equals(directory, backupDirectory, StringComparison.OrdinalIgnoreCase)
                    || directory.IndexOf(".backup-", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    continue;
                }
                versions.Add(new DirectoryInfo(directory));
            }
            versions.Sort(delegate(DirectoryInfo left, DirectoryInfo right)
            {
                return right.LastWriteTimeUtc.CompareTo(left.LastWriteTimeUtc);
            });
            for (int index = 1; index < versions.Count; index++)
            {
                TryDeleteDirectory(versions[index].FullName);
            }
        }

        private static void ScheduleInstallDirectoryRemoval(string root)
        {
            string uninstaller = Path.Combine(root, "Uninstall Minova.exe");
            string cleanupScript = Path.Combine(
                Path.GetTempPath(),
                "minova-uninstall-" + Guid.NewGuid().ToString("N") + ".ps1");
            string rootBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(root));
            string uninstallerBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(uninstaller));
            File.WriteAllText(
                cleanupScript,
                "$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"
                + rootBase64
                + "'))\r\n"
                + "$uninstaller=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"
                + uninstallerBase64
                + "'))\r\n"
                + "Start-Sleep -Milliseconds 1200\r\n"
                + "Remove-Item -LiteralPath $uninstaller -Force -ErrorAction SilentlyContinue\r\n"
                + "if ((Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {\r\n"
                + "  Remove-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue\r\n"
                + "}\r\n"
                + "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue\r\n");
            ProcessStartInfo start = new ProcessStartInfo(
                "powershell.exe",
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""
                + cleanupScript.Replace("\"", "")
                + "\"");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(start);
        }

        private static void DeleteFileOrThrow(string path)
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        private static void DeleteDirectoryOrThrow(string path)
        {
            if (!Directory.Exists(path))
            {
                return;
            }
            try
            {
                Directory.Delete(path, true);
            }
            catch (IOException error)
            {
                throw new IOException("Close Minova before uninstalling it, then try again.", error);
            }
            catch (UnauthorizedAccessException error)
            {
                throw new IOException("Close Minova before uninstalling it, then try again.", error);
            }
        }

        private static void WriteTextAtomically(string destination, string content)
        {
            string temporary = destination + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, content);
            if (File.Exists(destination))
            {
                File.Delete(destination);
            }
            File.Move(temporary, destination);
        }

        private static void TryDeleteFile(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
                // A running previous version can retain its files until the next update.
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, true);
                }
            }
            catch
            {
                // Keeping one locked previous version is safer than interrupting installation.
            }
        }

        private static void Report(Action<InstallProgress> report, string message, int percentage)
        {
            if (report != null)
            {
                report(new InstallProgress(message, percentage));
            }
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly Arguments Options;
        private readonly ReleaseInfo Release;
        private readonly bool UninstallMode;
        private readonly Label Heading;
        private readonly Label Subheading;
        private readonly TextBox InstallPath;
        private readonly Button BrowseButton;
        private readonly CheckBox DesktopShortcut;
        private readonly CheckBox StartMenuShortcut;
        private readonly AccentButton PrimaryButton;
        private readonly Button CancelAction;
        private readonly Label StatusLabel;
        private readonly Panel ProgressTrack;
        private readonly Panel ProgressFill;
        private readonly CheckBox LaunchAfterInstall;
        private bool Working;
        private bool Completed;
        private Point DragOrigin;

        internal InstallerForm(Arguments options)
        {
            Options = options;
            Release = InstallerEngine.CurrentRelease;
            UninstallMode = options.Uninstall;

            Text = UninstallMode ? "Uninstall Minova" : "Install Minova";
            ClientSize = new Size(780, 520);
            MinimumSize = new Size(780, 520);
            MaximumSize = new Size(780, 520);
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(14, 18, 25);
            ForeColor = Color.FromArgb(238, 244, 252);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);

            Panel titleBar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 48,
                BackColor = Color.FromArgb(10, 13, 19)
            };
            titleBar.MouseDown += BeginDrag;
            titleBar.MouseMove += ContinueDrag;
            Controls.Add(titleBar);

            PictureBox titleLogo = new PictureBox
            {
                Bounds = new Rectangle(16, 9, 30, 30),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = LoadEmbeddedImage()
            };
            titleBar.Controls.Add(titleLogo);

            Label title = new Label
            {
                AutoSize = true,
                Location = new Point(54, 14),
                Text = UninstallMode ? "Minova Uninstaller" : "Minova Installer",
                Font = new Font("Segoe UI Semibold", 10f),
                ForeColor = Color.FromArgb(226, 235, 246)
            };
            title.MouseDown += BeginDrag;
            title.MouseMove += ContinueDrag;
            titleBar.Controls.Add(title);

            Button minimize = MakeTitleButton("_", 684);
            minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
            titleBar.Controls.Add(minimize);
            Button close = MakeTitleButton("X", 732);
            close.Click += delegate { if (!Working) Close(); };
            close.MouseEnter += delegate { close.BackColor = Color.FromArgb(184, 52, 58); };
            close.MouseLeave += delegate { close.BackColor = Color.Transparent; };
            titleBar.Controls.Add(close);

            PictureBox logo = new PictureBox
            {
                Bounds = new Rectangle(56, 91, 108, 108),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = LoadEmbeddedImage()
            };
            Controls.Add(logo);

            string installedVersion = InstallerEngine.GetInstalledVersion();
            string modeText = UninstallMode
                ? "Remove Minova Browser"
                : String.IsNullOrEmpty(installedVersion)
                    ? "Install Minova " + Release.Version
                    : String.Equals(installedVersion, Release.Version, StringComparison.OrdinalIgnoreCase)
                        ? "Repair Minova " + Release.Version
                        : "Update Minova to " + Release.Version;
            Heading = new Label
            {
                AutoSize = true,
                Location = new Point(194, 92),
                Text = modeText,
                Font = new Font("Segoe UI Semibold", 24f),
                ForeColor = Color.White
            };
            Controls.Add(Heading);

            Subheading = new Label
            {
                Bounds = new Rectangle(198, 141, 510, 56),
                Text = UninstallMode
                    ? "This removes Minova application files and shortcuts. Your browser profile remains available."
                    : "A fast, private Chromium browser with protected streaming support and a UI built around you.",
                Font = new Font("Segoe UI", 10.5f),
                ForeColor = Color.FromArgb(151, 166, 185)
            };
            Controls.Add(Subheading);

            Label pathLabel = new Label
            {
                AutoSize = true,
                Location = new Point(58, 236),
                Text = "INSTALLATION FOLDER",
                Font = new Font("Segoe UI Semibold", 8.5f),
                ForeColor = Color.FromArgb(111, 205, 197)
            };
            Controls.Add(pathLabel);

            InstallPath = new TextBox
            {
                Bounds = new Rectangle(58, 259, 568, 38),
                Text = options.InstallDirectory,
                BackColor = Color.FromArgb(22, 29, 39),
                ForeColor = Color.FromArgb(232, 239, 248),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 10f)
            };
            Controls.Add(InstallPath);

            BrowseButton = new Button
            {
                Bounds = new Rectangle(638, 257, 84, 36),
                Text = "Browse",
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(29, 38, 51),
                ForeColor = Color.FromArgb(225, 234, 246),
                Cursor = Cursors.Hand
            };
            BrowseButton.FlatAppearance.BorderColor = Color.FromArgb(58, 72, 91);
            BrowseButton.Click += Browse;
            Controls.Add(BrowseButton);

            DesktopShortcut = MakeCheckBox("Create a desktop shortcut", 58, 320, options.DesktopShortcut);
            StartMenuShortcut = MakeCheckBox("Add Minova to the Start menu", 58, 351, options.StartMenuShortcut);
            Controls.Add(DesktopShortcut);
            Controls.Add(StartMenuShortcut);

            if (UninstallMode)
            {
                DesktopShortcut.Visible = false;
                StartMenuShortcut.Visible = false;
                InstallPath.ReadOnly = true;
                BrowseButton.Visible = false;
                pathLabel.Text = "CURRENT INSTALLATION";
            }

            Label license = new Label
            {
                AutoSize = true,
                Location = new Point(58, 397),
                Text = "GPL-3.0-only  |  Settings and browser data are preserved during updates.",
                ForeColor = Color.FromArgb(119, 132, 150),
                Font = new Font("Segoe UI", 8.5f)
            };
            Controls.Add(license);

            ProgressTrack = new Panel
            {
                Bounds = new Rectangle(58, 429, 664, 4),
                BackColor = Color.FromArgb(37, 46, 59),
                Visible = false
            };
            ProgressFill = new Panel
            {
                Bounds = new Rectangle(0, 0, 0, 4),
                BackColor = Color.FromArgb(27, 198, 185)
            };
            ProgressTrack.Controls.Add(ProgressFill);
            Controls.Add(ProgressTrack);

            StatusLabel = new Label
            {
                Bounds = new Rectangle(58, 444, 430, 32),
                Text = "Ready",
                ForeColor = Color.FromArgb(145, 159, 178),
                Visible = false
            };
            Controls.Add(StatusLabel);

            LaunchAfterInstall = MakeCheckBox("Launch Minova now", 58, 449, true);
            LaunchAfterInstall.Visible = false;
            Controls.Add(LaunchAfterInstall);

            CancelAction = new Button
            {
                Bounds = new Rectangle(512, 455, 92, 38),
                Text = "Cancel",
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(194, 205, 220),
                Cursor = Cursors.Hand
            };
            CancelAction.FlatAppearance.BorderColor = Color.FromArgb(61, 73, 89);
            CancelAction.Click += delegate { if (!Working) Close(); };
            Controls.Add(CancelAction);

            PrimaryButton = new AccentButton
            {
                Bounds = new Rectangle(616, 455, 106, 38),
                Text = UninstallMode
                    ? "Uninstall"
                    : String.IsNullOrEmpty(installedVersion)
                        ? "Install"
                        : String.Equals(installedVersion, Release.Version, StringComparison.OrdinalIgnoreCase)
                            ? "Repair"
                            : "Update",
                Cursor = Cursors.Hand
            };
            PrimaryButton.Click += StartAction;
            Controls.Add(PrimaryButton);

            Paint += DrawWindowBorder;
        }

        private void StartAction(object sender, EventArgs eventArgs)
        {
            if (Completed)
            {
                if (!UninstallMode && LaunchAfterInstall.Checked)
                {
                    try
                    {
                        InstallerEngine.Launch(InstallPath.Text);
                    }
                    catch (Exception error)
                    {
                        MessageBox.Show(this, error.Message, "Minova", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }
                }
                Close();
                return;
            }

            if (UninstallMode)
            {
                DialogResult confirmation = MessageBox.Show(
                    this,
                    "Remove Minova Browser from this computer?\r\n\r\nYour browser profile and personal data will not be deleted.",
                    "Uninstall Minova",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (confirmation != DialogResult.Yes)
                {
                    return;
                }
            }

            SetWorking(true);
            string selectedPath = InstallPath.Text;
            bool desktop = DesktopShortcut.Checked;
            bool startMenu = StartMenuShortcut.Checked;
            Task.Factory.StartNew(delegate
            {
                try
                {
                    Action<InstallProgress> progress = delegate(InstallProgress update)
                    {
                        BeginInvoke(new Action(delegate { ApplyProgress(update); }));
                    };
                    if (UninstallMode)
                    {
                        InstallerEngine.Uninstall(selectedPath, false, progress);
                    }
                    else
                    {
                        InstallerEngine.Install(selectedPath, desktop, startMenu, false, progress);
                    }
                    BeginInvoke(new Action(ShowCompleted));
                }
                catch (Exception error)
                {
                    BeginInvoke(new Action(delegate { ShowFailure(error); }));
                }
            });
        }

        private void SetWorking(bool working)
        {
            Working = working;
            InstallPath.Enabled = !working && !UninstallMode;
            BrowseButton.Enabled = !working;
            DesktopShortcut.Enabled = !working;
            StartMenuShortcut.Enabled = !working;
            PrimaryButton.Enabled = !working;
            CancelAction.Enabled = !working;
            ProgressTrack.Visible = working;
            StatusLabel.Visible = working;
        }

        private void ApplyProgress(InstallProgress progress)
        {
            StatusLabel.Text = progress.Message;
            ProgressFill.Width = (int)Math.Round(ProgressTrack.ClientSize.Width * progress.Percentage / 100d);
            ProgressFill.Height = ProgressTrack.ClientSize.Height;
        }

        private void ShowCompleted()
        {
            Working = false;
            Completed = true;
            Heading.Text = UninstallMode ? "Minova was removed" : "Minova is ready";
            Subheading.Text = UninstallMode
                ? "Application files and shortcuts were removed. Your browser profile was left untouched."
                : "Installation completed successfully. Minova " + Release.Version + " is ready to use.";
            PrimaryButton.Enabled = true;
            PrimaryButton.Text = "Finish";
            CancelAction.Visible = false;
            InstallPath.Visible = false;
            BrowseButton.Visible = false;
            DesktopShortcut.Visible = false;
            StartMenuShortcut.Visible = false;
            ProgressTrack.Visible = false;
            StatusLabel.Visible = false;
            LaunchAfterInstall.Visible = !UninstallMode;
        }

        private void ShowFailure(Exception error)
        {
            SetWorking(false);
            ProgressTrack.Visible = false;
            StatusLabel.Visible = true;
            StatusLabel.ForeColor = Color.FromArgb(242, 112, 117);
            StatusLabel.Text = "Installation could not finish.";
            MessageBox.Show(
                this,
                error.Message + "\r\n\r\nNo working Minova version was removed.",
                "Minova Installer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        private void Browse(object sender, EventArgs eventArgs)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "Choose where Minova should be installed.";
                dialog.SelectedPath = Directory.Exists(InstallPath.Text)
                    ? InstallPath.Text
                    : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    string selected = dialog.SelectedPath;
                    bool alreadyMinova = String.Equals(
                        Path.GetFileName(selected.TrimEnd(Path.DirectorySeparatorChar)),
                        "Minova",
                        StringComparison.OrdinalIgnoreCase);
                    InstallPath.Text = alreadyMinova ? selected : Path.Combine(selected, "Minova");
                }
            }
        }

        private static CheckBox MakeCheckBox(string text, int x, int y, bool isChecked)
        {
            return new CheckBox
            {
                AutoSize = true,
                Location = new Point(x, y),
                Text = text,
                Checked = isChecked,
                ForeColor = Color.FromArgb(202, 213, 227),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
        }

        private static Button MakeTitleButton(string text, int x)
        {
            Button button = new Button
            {
                Bounds = new Rectangle(x, 0, 48, 48),
                Text = text,
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(205, 216, 230),
                TabStop = false
            };
            button.FlatAppearance.BorderSize = 0;
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(31, 39, 50);
            return button;
        }

        private static Image LoadEmbeddedImage()
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.logo"))
            {
                if (source == null)
                {
                    return null;
                }
                using (Image image = Image.FromStream(source))
                {
                    return new Bitmap(image);
                }
            }
        }

        private void BeginDrag(object sender, MouseEventArgs eventArgs)
        {
            if (eventArgs.Button == MouseButtons.Left)
            {
                DragOrigin = new Point(eventArgs.X, eventArgs.Y);
            }
        }

        private void ContinueDrag(object sender, MouseEventArgs eventArgs)
        {
            if (eventArgs.Button == MouseButtons.Left)
            {
                Point screen = ((Control)sender).PointToScreen(eventArgs.Location);
                Location = new Point(screen.X - DragOrigin.X, screen.Y - DragOrigin.Y);
            }
        }

        private void DrawWindowBorder(object sender, PaintEventArgs eventArgs)
        {
            using (Pen border = new Pen(Color.FromArgb(44, 56, 72)))
            {
                eventArgs.Graphics.DrawRectangle(border, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
            }
        }
    }

    internal sealed class AccentButton : Button
    {
        internal AccentButton()
        {
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            BackColor = Color.FromArgb(22, 184, 174);
            ForeColor = Color.FromArgb(5, 25, 24);
            Font = new Font("Segoe UI Semibold", 9.5f);
        }

        protected override void OnPaint(PaintEventArgs eventArgs)
        {
            eventArgs.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Color fill = Enabled ? BackColor : Color.FromArgb(64, 88, 91);
            using (GraphicsPath path = RoundedRectangle(ClientRectangle, 6))
            using (SolidBrush brush = new SolidBrush(fill))
            {
                eventArgs.Graphics.FillPath(brush, path);
            }
            TextRenderer.DrawText(
                eventArgs.Graphics,
                Text,
                Font,
                ClientRectangle,
                Enabled ? ForeColor : Color.FromArgb(151, 165, 174),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            Rectangle arc = new Rectangle(bounds.X, bounds.Y, diameter, diameter);
            path.AddArc(arc, 180, 90);
            arc.X = bounds.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = bounds.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = bounds.X;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
