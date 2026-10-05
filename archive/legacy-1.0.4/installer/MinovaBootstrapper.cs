using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Ellipse = System.Windows.Shapes.Ellipse;
using Line = System.Windows.Shapes.Line;
using Forms = System.Windows.Forms;

namespace Minova.Bootstrapper
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            InstallerOptions options = InstallerOptions.Parse(args);
            if (options.Silent)
            {
                try
                {
                    BootstrapperEngine.Install(options, null);
                    Environment.ExitCode = 0;
                }
                catch (Exception error)
                {
                    BootstrapperEngine.WriteLog(error);
                    Environment.ExitCode = 1;
                }
                return;
            }

            Application application = new Application();
            application.ShutdownMode = ShutdownMode.OnMainWindowClose;
            application.Run(new InstallerWindow(options));
        }
    }

    internal sealed class InstallerOptions
    {
        internal bool Silent;
        internal bool TestMode;
        internal bool DesktopShortcut = true;
        internal bool StartMenuShortcut = true;
        internal string InstallDirectory = BootstrapperEngine.DefaultInstallDirectory;

        internal static InstallerOptions Parse(string[] args)
        {
            InstallerOptions options = new InstallerOptions();
            foreach (string rawArgument in args)
            {
                string argument = rawArgument ?? "";
                if (String.Equals(argument, "/S", StringComparison.OrdinalIgnoreCase)
                    || String.Equals(argument, "/silent", StringComparison.OrdinalIgnoreCase))
                {
                    options.Silent = true;
                }
                else if (String.Equals(argument, "/test", StringComparison.OrdinalIgnoreCase))
                {
                    options.TestMode = true;
                }
                else if (String.Equals(argument, "/noDesktopShortcut", StringComparison.OrdinalIgnoreCase))
                {
                    options.DesktopShortcut = false;
                }
                else if (String.Equals(argument, "/noStartMenuShortcut", StringComparison.OrdinalIgnoreCase))
                {
                    options.StartMenuShortcut = false;
                }
                else if (argument.StartsWith("/installDir=", StringComparison.OrdinalIgnoreCase))
                {
                    options.InstallDirectory = argument.Substring("/installDir=".Length).Trim('"');
                }
            }
            return options;
        }
    }

    internal sealed class ReleaseInfo
    {
        internal string Version = "1.0.2";
        internal string SetupFileName = "Minova-Chromium-Update-1.0.2.exe";
        internal string SetupSha256 = "";
        internal long SetupBytes;

        internal static ReleaseInfo Load()
        {
            ReleaseInfo result = new ReleaseInfo();
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.bootstrapper"))
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
                        else if (key == "setupFileName")
                        {
                            result.SetupFileName = value;
                        }
                        else if (key == "setupSha256")
                        {
                            result.SetupSha256 = value;
                        }
                        else if (key == "setupBytes")
                        {
                            long.TryParse(value, out result.SetupBytes);
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

    internal static class BootstrapperEngine
    {
        private static readonly ReleaseInfo Release = ReleaseInfo.Load();
        internal static readonly string DefaultInstallDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "Minova");

        internal static ReleaseInfo CurrentRelease
        {
            get { return Release; }
        }

        internal static void Install(InstallerOptions options, Action<InstallProgress> report)
        {
            string installDirectory = NormalizeInstallDirectory(options.InstallDirectory);
            EnsureFreeSpace(installDirectory);
            Report(report, "Preparing browser files", 3);

            string temporaryRoot = Path.Combine(
                Path.GetTempPath(),
                "MinovaSetup",
                Release.Version,
                Guid.NewGuid().ToString("N"));
            string setupPath = Path.Combine(temporaryRoot, Release.SetupFileName);
            try
            {
                Directory.CreateDirectory(temporaryRoot);
                Report(report, "Verifying the Minova package", 8);
                ExtractEmbeddedSetup(setupPath);
                VerifySetup(setupPath);
                if (options.TestMode)
                {
                    SimulateInstall(report);
                    return;
                }

                Report(report, "Installing Minova", 16);
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = setupPath;
                start.Arguments = BuildSetupArguments(options, installDirectory);
                start.WorkingDirectory = temporaryRoot;
                start.UseShellExecute = false;
                start.CreateNoWindow = true;

                using (Process process = Process.Start(start))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException("Windows could not start the Minova installation package.");
                    }
                    int percentage = 16;
                    while (!process.WaitForExit(350))
                    {
                        percentage = Math.Min(88, percentage + Math.Max(1, (92 - percentage) / 12));
                        Report(report, ProgressMessage(percentage), percentage);
                    }
                    if (process.ExitCode != 0)
                    {
                        throw new InvalidOperationException(
                            "Minova Setup stopped with Windows installer code " + process.ExitCode + ".");
                    }
                }

                Report(report, "Creating Windows shortcuts", 92);
                if (!options.StartMenuShortcut)
                {
                    RemoveStartMenuShortcut();
                }
                Report(report, "Running final checks", 97);
                ValidateInstalledApplication(installDirectory);
                Report(report, "Minova is ready", 100);
            }
            catch (Exception error)
            {
                WriteLog(error);
                throw;
            }
            finally
            {
                TryDeleteDirectory(temporaryRoot);
            }
        }

        internal static void Launch(string installDirectory)
        {
            string executable = Path.Combine(NormalizeInstallDirectory(installDirectory), "Minova.exe");
            if (!File.Exists(executable))
            {
                executable = Path.Combine(DefaultInstallDirectory, "Minova.exe");
            }
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException("The installed Minova executable could not be found.", executable);
            }
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
        }

        internal static void WriteLog(Exception error)
        {
            try
            {
                string logPath = Path.Combine(Path.GetTempPath(), "MinovaSetup.log");
                File.AppendAllText(
                    logPath,
                    DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine + Environment.NewLine,
                    Encoding.UTF8);
            }
            catch
            {
                // Installer logging must never replace the original error.
            }
        }

        private static string BuildSetupArguments(InstallerOptions options, string installDirectory)
        {
            StringBuilder arguments = new StringBuilder("/S");
            if (!options.DesktopShortcut)
            {
                arguments.Append(" --no-desktop-shortcut");
            }
            // NSIS requires /D to be the final argument and consumes spaces itself.
            arguments.Append(" /D=");
            arguments.Append(installDirectory);
            return arguments.ToString();
        }

        private static void ExtractEmbeddedSetup(string destination)
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.setup"))
            {
                if (source == null)
                {
                    throw new InvalidDataException("The updater-compatible Minova package is missing.");
                }
                using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    source.CopyTo(output);
                }
            }
        }

        private static void VerifySetup(string setupPath)
        {
            FileInfo file = new FileInfo(setupPath);
            if (Release.SetupBytes > 0 && file.Length != Release.SetupBytes)
            {
                throw new InvalidDataException("The Minova package size did not pass verification.");
            }
            if (String.IsNullOrWhiteSpace(Release.SetupSha256))
            {
                throw new InvalidDataException("The Minova package checksum is missing.");
            }
            string actualHash;
            using (SHA256 algorithm = SHA256.Create())
            using (FileStream stream = File.OpenRead(setupPath))
            {
                actualHash = BytesToHex(algorithm.ComputeHash(stream));
            }
            if (!String.Equals(actualHash, Release.SetupSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("The Minova package did not pass integrity verification.");
            }
        }

        private static string BytesToHex(byte[] bytes)
        {
            StringBuilder result = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes)
            {
                result.Append(value.ToString("x2"));
            }
            return result.ToString();
        }

        private static string NormalizeInstallDirectory(string value)
        {
            if (String.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException("Choose an installation folder.");
            }
            string fullPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(value.Trim()));
            string root = Path.GetPathRoot(fullPath) ?? "";
            if (String.Equals(
                fullPath.TrimEnd(Path.DirectorySeparatorChar),
                root.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Minova cannot be installed directly into a drive root.");
            }
            return fullPath.TrimEnd(Path.DirectorySeparatorChar);
        }

        private static void EnsureFreeSpace(string installDirectory)
        {
            string root = Path.GetPathRoot(installDirectory);
            if (String.IsNullOrWhiteSpace(root))
            {
                return;
            }
            DriveInfo drive = new DriveInfo(root);
            long required = Math.Max(Release.SetupBytes * 3L, 512L * 1024L * 1024L);
            if (drive.AvailableFreeSpace < required)
            {
                throw new IOException("Minova needs about "
                    + Math.Ceiling(required / 1024d / 1024d)
                    + " MB of free space on this drive.");
            }
        }

        private static string ProgressMessage(int percentage)
        {
            if (percentage < 72)
            {
                return "Installing Minova";
            }
            if (percentage < 90)
            {
                return "Writing browser components";
            }
            return "Creating Windows shortcuts";
        }

        private static void ValidateInstalledApplication(string installDirectory)
        {
            string executable = Path.Combine(installDirectory, "Minova.exe");
            if (!File.Exists(executable))
            {
                throw new InvalidDataException("Windows did not finish installing Minova.exe.");
            }
        }

        private static void RemoveStartMenuShortcut()
        {
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            foreach (string candidate in new[]
            {
                Path.Combine(programs, "Minova.lnk"),
                Path.Combine(programs, "Minova", "Minova.lnk")
            })
            {
                try
                {
                    if (File.Exists(candidate))
                    {
                        File.Delete(candidate);
                    }
                    string parent = Path.GetDirectoryName(candidate);
                    if (!String.IsNullOrEmpty(parent)
                        && !String.Equals(parent, programs, StringComparison.OrdinalIgnoreCase)
                        && Directory.Exists(parent)
                        && Directory.GetFileSystemEntries(parent).Length == 0)
                    {
                        Directory.Delete(parent);
                    }
                }
                catch
                {
                    // A shortcut preference should not make the browser installation fail.
                }
            }
        }

        private static void SimulateInstall(Action<InstallProgress> report)
        {
            foreach (InstallProgress update in new[]
            {
                new InstallProgress("Preparing browser files", 8),
                new InstallProgress("Installing Minova", 35),
                new InstallProgress("Writing browser components", 72),
                new InstallProgress("Creating Windows shortcuts", 92),
                new InstallProgress("Running final checks", 98),
                new InstallProgress("Minova is ready", 100)
            })
            {
                Thread.Sleep(220);
                Report(report, update.Message, update.Percentage);
            }
        }

        private static void Report(Action<InstallProgress> report, string message, int percentage)
        {
            if (report != null)
            {
                report(new InstallProgress(message, percentage));
            }
        }

        private static void TryDeleteDirectory(string path)
        {
            if (String.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            {
                return;
            }
            for (int attempt = 0; attempt < 10; attempt++)
            {
                try
                {
                    Directory.Delete(path, true);
                    return;
                }
                catch
                {
                    // Antivirus can briefly retain a handle to the extracted setup.
                    Thread.Sleep(150 + (attempt * 50));
                }
            }
        }
    }

    internal sealed class InstallerWindow : Window
    {
        private static readonly Brush CanvasBrush = BrushFrom("#060a10");
        private static readonly Brush TitlebarBrush = BrushFrom("#090e16");
        private static readonly Brush SurfaceBrush = BrushFrom("#0d141e");
        private static readonly Brush LeftBrush = BrushFrom("#09111a");
        private static readonly Brush BorderBrushValue = BrushFrom("#263446");
        private static readonly Brush TextBrush = BrushFrom("#f3f7fc");
        private static readonly Brush MutedBrush = BrushFrom("#9aacc2");
        private static readonly Brush AccentBrush = BrushFrom("#20c9c2");
        private static readonly Brush AccentHoverBrush = BrushFrom("#37d8d0");
        private static readonly Brush AccentInkBrush = BrushFrom("#031817");
        private static readonly Brush BlueBrush = BrushFrom("#48a7ff");

        private readonly InstallerOptions Options;
        private readonly ReleaseInfo Release;
        private readonly Grid ContentHost;
        private readonly Button PrimaryButton;
        private readonly Button CancelButton;
        private TextBox InstallPath;
        private OptionToggle DesktopShortcut;
        private OptionToggle StartMenuShortcut;
        private Border ProgressFill;
        private TextBlock ProgressStatus;
        private TextBlock ProgressPercent;
        private Grid StageGrid;
        private OptionToggle LaunchAfterInstall;
        private bool Working;
        private bool Completed;

        internal InstallerWindow(InstallerOptions options)
        {
            Options = options;
            Release = BootstrapperEngine.CurrentRelease;
            Title = "Minova Setup";
            Width = 940;
            Height = 620;
            MinWidth = 940;
            MinHeight = 620;
            MaxWidth = 940;
            MaxHeight = 620;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = CanvasBrush;
            Foreground = TextBrush;
            FontFamily = new FontFamily("Segoe UI");

            Border windowBorder = new Border();
            windowBorder.BorderBrush = BorderBrushValue;
            windowBorder.BorderThickness = new Thickness(1);
            windowBorder.Background = SurfaceBrush;
            Content = windowBorder;

            Grid root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(48) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            windowBorder.Child = root;

            Border accent = new Border();
            accent.Height = 2;
            accent.Background = AccentBrush;
            accent.VerticalAlignment = VerticalAlignment.Top;
            Panel.SetZIndex(accent, 10);
            root.Children.Add(accent);

            UIElement titlebar = BuildTitlebar();
            Grid.SetRow(titlebar, 0);
            root.Children.Add(titlebar);

            Grid body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(286) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetRow(body, 1);
            root.Children.Add(body);

            UIElement brandPanel = BuildBrandPanel();
            Grid.SetColumn(brandPanel, 0);
            body.Children.Add(brandPanel);

            Grid setupPanel = new Grid();
            setupPanel.Background = SurfaceBrush;
            setupPanel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            setupPanel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(78) });
            Grid.SetColumn(setupPanel, 1);
            body.Children.Add(setupPanel);

            ContentHost = new Grid();
            ContentHost.Margin = new Thickness(52, 44, 52, 0);
            Grid.SetRow(ContentHost, 0);
            setupPanel.Children.Add(ContentHost);

            Border footer = new Border();
            footer.BorderBrush = BrushFrom("#1c2837");
            footer.BorderThickness = new Thickness(0, 1, 0, 0);
            Grid.SetRow(footer, 1);
            setupPanel.Children.Add(footer);

            Grid footerGrid = new Grid();
            footerGrid.Margin = new Thickness(52, 0, 52, 0);
            footerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            footer.Child = footerGrid;

            TextBlock license = Text("GPL-3.0 licensed", 11, BrushFrom("#8194ab"), FontWeights.Normal);
            license.VerticalAlignment = VerticalAlignment.Center;
            footerGrid.Children.Add(license);

            StackPanel actions = new StackPanel();
            actions.Orientation = Orientation.Horizontal;
            actions.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(actions, 1);
            footerGrid.Children.Add(actions);

            CancelButton = CreateButton("Cancel", false, 88);
            CancelButton.Margin = new Thickness(0, 0, 10, 0);
            CancelButton.Click += delegate
            {
                if (!Working)
                {
                    Close();
                }
                else
                {
                    WindowState = WindowState.Minimized;
                }
            };
            actions.Children.Add(CancelButton);

            PrimaryButton = CreateButton("Install Minova", true, 148);
            PrimaryButton.Click += StartInstall;
            actions.Children.Add(PrimaryButton);

            BuildReadyPage();
        }

        private UIElement BuildTitlebar()
        {
            Grid titlebar = new Grid();
            titlebar.Background = TitlebarBrush;
            titlebar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            titlebar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            titlebar.MouseLeftButtonDown += delegate
            {
                if (Mouse.LeftButton == MouseButtonState.Pressed)
                {
                    DragMove();
                }
            };

            StackPanel brand = new StackPanel();
            brand.Orientation = Orientation.Horizontal;
            brand.VerticalAlignment = VerticalAlignment.Center;
            brand.Margin = new Thickness(16, 0, 0, 0);
            Image logo = Logo(25);
            brand.Children.Add(logo);
            TextBlock label = Text("Minova Setup", 13, BrushFrom("#dce6f3"), FontWeights.SemiBold);
            label.Margin = new Thickness(10, 0, 0, 0);
            label.VerticalAlignment = VerticalAlignment.Center;
            brand.Children.Add(label);
            titlebar.Children.Add(brand);

            StackPanel controls = new StackPanel();
            controls.Orientation = Orientation.Horizontal;
            Grid.SetColumn(controls, 1);
            titlebar.Children.Add(controls);

            Button minimize = CreateTitleButton(false);
            minimize.Click += delegate { WindowState = WindowState.Minimized; };
            controls.Children.Add(minimize);
            Button close = CreateTitleButton(true);
            close.Click += delegate
            {
                if (!Working)
                {
                    Close();
                }
            };
            controls.Children.Add(close);
            return titlebar;
        }

        private UIElement BuildBrandPanel()
        {
            Grid panel = new Grid();
            panel.Background = LeftBrush;
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            panel.Margin = new Thickness(0);

            StackPanel identity = new StackPanel();
            identity.Margin = new Thickness(38, 48, 38, 0);
            Border logoFrame = new Border();
            logoFrame.Width = 82;
            logoFrame.Height = 82;
            logoFrame.HorizontalAlignment = HorizontalAlignment.Left;
            logoFrame.BorderBrush = BrushFrom("#26394c");
            logoFrame.BorderThickness = new Thickness(1);
            logoFrame.CornerRadius = new CornerRadius(8);
            logoFrame.Child = Logo(80);
            identity.Children.Add(logoFrame);

            TextBlock brandEyebrow = Eyebrow("MINOVA CHROMIUM");
            brandEyebrow.Margin = new Thickness(0, 34, 0, 0);
            identity.Children.Add(brandEyebrow);
            TextBlock heading = Text("Browse your\nway.", 30, TextBrush, FontWeights.SemiBold);
            heading.LineHeight = 37;
            heading.Margin = new Thickness(0, 12, 0, 0);
            identity.Children.Add(heading);
            TextBlock copy = Text(
                "A focused Chromium browser with custom themes, useful privacy controls, and protected streaming.",
                14,
                MutedBrush,
                FontWeights.Normal);
            copy.TextWrapping = TextWrapping.Wrap;
            copy.LineHeight = 22;
            copy.Margin = new Thickness(0, 16, 0, 0);
            identity.Children.Add(copy);
            panel.Children.Add(identity);

            StackPanel version = new StackPanel();
            version.Margin = new Thickness(38, 0, 38, 34);
            Grid.SetRow(version, 2);
            version.Children.Add(Text("Version " + Release.Version, 12, BrushFrom("#b9c6d6"), FontWeights.Normal));
            TextBlock platform = Text("Windows 10 and 11 \u00b7 64-bit", 11, BrushFrom("#71849b"), FontWeights.Normal);
            platform.Margin = new Thickness(0, 5, 0, 0);
            version.Children.Add(platform);
            panel.Children.Add(version);

            Border separator = new Border();
            separator.Width = 1;
            separator.HorizontalAlignment = HorizontalAlignment.Right;
            separator.Background = BrushFrom("#1d2a39");
            panel.Children.Add(separator);
            return panel;
        }

        private void BuildReadyPage()
        {
            ContentHost.Children.Clear();
            Grid page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            ContentHost.Children.Add(page);

            StackPanel heading = new StackPanel();
            heading.Children.Add(Eyebrow("READY TO INSTALL"));
            TextBlock title = Text("Install Minova", 31, TextBrush, FontWeights.SemiBold);
            title.Margin = new Thickness(0, 8, 0, 0);
            heading.Children.Add(title);
            TextBlock copy = Text(
                "Set up Minova for this Windows account. Your browser data will stay on this device.",
                14,
                MutedBrush,
                FontWeights.Normal);
            copy.Margin = new Thickness(0, 12, 0, 0);
            heading.Children.Add(copy);
            page.Children.Add(heading);

            StackPanel pathSection = new StackPanel();
            pathSection.Margin = new Thickness(0, 31, 0, 0);
            Grid.SetRow(pathSection, 1);
            pathSection.Children.Add(Text("Installation folder", 12, BrushFrom("#dbe5f1"), FontWeights.SemiBold));
            Grid pathRow = new Grid();
            pathRow.Margin = new Thickness(0, 8, 0, 0);
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(98) });
            pathSection.Children.Add(pathRow);

            Border inputBorder = new Border();
            inputBorder.Height = 42;
            inputBorder.Background = BrushFrom("#0a111a");
            inputBorder.BorderBrush = BorderBrushValue;
            inputBorder.BorderThickness = new Thickness(1);
            inputBorder.CornerRadius = new CornerRadius(6);
            inputBorder.Margin = new Thickness(0, 0, 10, 0);
            InstallPath = new TextBox();
            InstallPath.Text = Options.InstallDirectory;
            InstallPath.Background = Brushes.Transparent;
            InstallPath.Foreground = BrushFrom("#e8eef6");
            InstallPath.BorderThickness = new Thickness(0);
            InstallPath.Padding = new Thickness(12, 10, 12, 8);
            InstallPath.FontSize = 13;
            inputBorder.Child = InstallPath;
            pathRow.Children.Add(inputBorder);

            Button browse = CreateButton("Browse", false, 88);
            browse.Height = 42;
            browse.Click += BrowseForFolder;
            Grid.SetColumn(browse, 1);
            pathRow.Children.Add(browse);
            page.Children.Add(pathSection);

            StackPanel options = new StackPanel();
            options.Margin = new Thickness(0, 22, 0, 0);
            Grid.SetRow(options, 2);
            DesktopShortcut = new OptionToggle(
                "Desktop shortcut",
                "Keep Minova within easy reach.",
                Options.DesktopShortcut,
                AccentBrush);
            StartMenuShortcut = new OptionToggle(
                "Start menu shortcut",
                "Find Minova from Windows Search.",
                Options.StartMenuShortcut,
                AccentBrush);
            StartMenuShortcut.Margin = new Thickness(0, 7, 0, 0);
            options.Children.Add(DesktopShortcut);
            options.Children.Add(StartMenuShortcut);
            page.Children.Add(options);

            StackPanel summary = new StackPanel();
            summary.Orientation = Orientation.Horizontal;
            summary.Margin = new Thickness(0, 16, 0, 0);
            Grid.SetRow(summary, 3);
            summary.Children.Add(SummaryItem("312 MB required"));
            TextBlock account = SummaryItem("Installs for this account");
            account.Margin = new Thickness(22, 0, 0, 0);
            summary.Children.Add(account);
            page.Children.Add(summary);
        }

        private void BuildProgressPage()
        {
            ContentHost.Children.Clear();
            StackPanel page = new StackPanel();
            ContentHost.Children.Add(page);
            page.Children.Add(Eyebrow("INSTALLING"));
            TextBlock title = Text("Making Minova yours", 31, TextBrush, FontWeights.SemiBold);
            title.Margin = new Thickness(0, 8, 0, 0);
            page.Children.Add(title);
            TextBlock copy = Text(
                "Minova is being installed. This usually takes less than a minute.",
                14,
                MutedBrush,
                FontWeights.Normal);
            copy.Margin = new Thickness(0, 12, 0, 0);
            page.Children.Add(copy);

            Grid progressHeading = new Grid();
            progressHeading.Margin = new Thickness(0, 48, 0, 0);
            progressHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progressHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ProgressStatus = Text("Preparing browser files", 13, BrushFrom("#dce6f2"), FontWeights.SemiBold);
            ProgressPercent = Text("0%", 13, AccentBrush, FontWeights.Bold);
            Grid.SetColumn(ProgressPercent, 1);
            progressHeading.Children.Add(ProgressStatus);
            progressHeading.Children.Add(ProgressPercent);
            page.Children.Add(progressHeading);

            Border progressTrack = new Border();
            progressTrack.Height = 7;
            progressTrack.Margin = new Thickness(0, 12, 0, 0);
            progressTrack.Background = BrushFrom("#1a2736");
            progressTrack.CornerRadius = new CornerRadius(4);
            progressTrack.HorizontalAlignment = HorizontalAlignment.Stretch;
            ProgressFill = new Border();
            ProgressFill.Width = 0;
            ProgressFill.HorizontalAlignment = HorizontalAlignment.Left;
            ProgressFill.Background = AccentBrush;
            ProgressFill.CornerRadius = new CornerRadius(4);
            progressTrack.Child = ProgressFill;
            page.Children.Add(progressTrack);

            StageGrid = new Grid();
            StageGrid.Margin = new Thickness(0, 32, 0, 0);
            for (int index = 0; index < 4; index++)
            {
                StageGrid.ColumnDefinitions.Add(new ColumnDefinition());
            }
            string[] stages = { "Preparing files", "Installing browser", "Creating shortcuts", "Final checks" };
            for (int index = 0; index < stages.Length; index++)
            {
                StackPanel stage = new StackPanel();
                stage.Tag = index;
                Ellipse marker = new Ellipse();
                marker.Name = "Marker";
                marker.Width = 12;
                marker.Height = 12;
                marker.Stroke = BrushFrom("#35485f");
                marker.StrokeThickness = 2;
                marker.Fill = SurfaceBrush;
                marker.HorizontalAlignment = HorizontalAlignment.Center;
                stage.Children.Add(marker);
                TextBlock label = Text(stages[index], 11, BrushFrom("#6f8299"), FontWeights.Normal);
                label.Name = "Label";
                label.Margin = new Thickness(0, 10, 0, 0);
                label.HorizontalAlignment = HorizontalAlignment.Center;
                stage.Children.Add(label);
                Grid.SetColumn(stage, index);
                StageGrid.Children.Add(stage);
            }
            page.Children.Add(StageGrid);
            TextBlock note = Text(
                "You can minimize this window while Minova finishes.",
                12,
                BrushFrom("#71849c"),
                FontWeights.Normal);
            note.Margin = new Thickness(0, 34, 0, 0);
            note.HorizontalAlignment = HorizontalAlignment.Center;
            page.Children.Add(note);
            UpdateProgress(new InstallProgress("Preparing browser files", 0));
        }

        private void BuildCompletePage()
        {
            ContentHost.Children.Clear();
            StackPanel page = new StackPanel();
            page.HorizontalAlignment = HorizontalAlignment.Center;
            page.Margin = new Thickness(0, 12, 0, 0);
            ContentHost.Children.Add(page);

            Grid success = new Grid();
            success.Width = 62;
            success.Height = 62;
            Ellipse circle = new Ellipse();
            circle.Fill = BrushFrom("#133027");
            circle.Stroke = BrushFrom("#4bd59d");
            circle.StrokeThickness = 1;
            success.Children.Add(circle);
            TextBlock check = Text("\u2713", 30, BrushFrom("#4bd59d"), FontWeights.SemiBold);
            check.HorizontalAlignment = HorizontalAlignment.Center;
            check.VerticalAlignment = VerticalAlignment.Center;
            success.Children.Add(check);
            page.Children.Add(success);

            TextBlock eyebrow = Eyebrow("INSTALLATION COMPLETE");
            eyebrow.HorizontalAlignment = HorizontalAlignment.Center;
            eyebrow.Margin = new Thickness(0, 24, 0, 0);
            page.Children.Add(eyebrow);
            TextBlock title = Text("Minova is ready", 31, TextBrush, FontWeights.SemiBold);
            title.HorizontalAlignment = HorizontalAlignment.Center;
            title.Margin = new Thickness(0, 8, 0, 0);
            page.Children.Add(title);
            TextBlock copy = Text(
                "Version " + Release.Version + " is installed and ready for your first tab.",
                14,
                MutedBrush,
                FontWeights.Normal);
            copy.HorizontalAlignment = HorizontalAlignment.Center;
            copy.Margin = new Thickness(0, 12, 0, 0);
            page.Children.Add(copy);

            LaunchAfterInstall = new OptionToggle(
                "Open Minova now",
                "Start browsing when setup closes.",
                true,
                AccentBrush);
            LaunchAfterInstall.Width = 300;
            LaunchAfterInstall.Margin = new Thickness(0, 34, 0, 0);
            page.Children.Add(LaunchAfterInstall);
        }

        private async void StartInstall(object sender, RoutedEventArgs eventArgs)
        {
            if (Completed)
            {
                if (LaunchAfterInstall != null && LaunchAfterInstall.IsChecked)
                {
                    try
                    {
                        BootstrapperEngine.Launch(Options.InstallDirectory);
                    }
                    catch (Exception error)
                    {
                        ShowFailure(error);
                        return;
                    }
                }
                Close();
                return;
            }

            string selectedDirectory;
            try
            {
                selectedDirectory = Path.GetFullPath(
                    Environment.ExpandEnvironmentVariables(InstallPath.Text.Trim()));
            }
            catch (Exception error)
            {
                ShowFailure(error);
                return;
            }

            Options.InstallDirectory = selectedDirectory;
            Options.DesktopShortcut = DesktopShortcut.IsChecked;
            Options.StartMenuShortcut = StartMenuShortcut.IsChecked;
            Working = true;
            PrimaryButton.Visibility = Visibility.Collapsed;
            CancelButton.Content = "Minimize";
            BuildProgressPage();

            try
            {
                await Task.Run(delegate
                {
                    BootstrapperEngine.Install(Options, delegate(InstallProgress progress)
                    {
                        Dispatcher.BeginInvoke(new Action(delegate { UpdateProgress(progress); }));
                    });
                });
                Working = false;
                Completed = true;
                BuildCompletePage();
                CancelButton.Visibility = Visibility.Collapsed;
                PrimaryButton.Visibility = Visibility.Visible;
                PrimaryButton.Content = "Open Minova";
                PrimaryButton.Width = 132;
            }
            catch (Exception error)
            {
                Working = false;
                PrimaryButton.Visibility = Visibility.Visible;
                CancelButton.Content = "Cancel";
                ShowFailure(error);
                BuildReadyPage();
            }
        }

        private void UpdateProgress(InstallProgress progress)
        {
            if (ProgressFill == null)
            {
                return;
            }
            ProgressStatus.Text = progress.Message;
            ProgressPercent.Text = progress.Percentage + "%";
            ProgressFill.Width = 548d * progress.Percentage / 100d;
            int activeStage = progress.Percentage < 18
                ? 0
                : progress.Percentage < 73
                    ? 1
                    : progress.Percentage < 94
                        ? 2
                        : 3;
            foreach (UIElement element in StageGrid.Children)
            {
                StackPanel stage = element as StackPanel;
                if (stage == null)
                {
                    continue;
                }
                int stageIndex = (int)stage.Tag;
                Ellipse marker = stage.Children[0] as Ellipse;
                TextBlock label = stage.Children[1] as TextBlock;
                bool reached = stageIndex <= activeStage;
                bool completed = stageIndex < activeStage;
                marker.Stroke = reached ? AccentBrush : BrushFrom("#35485f");
                marker.Fill = completed ? AccentBrush : SurfaceBrush;
                label.Foreground = reached ? BrushFrom("#dce6f2") : BrushFrom("#6f8299");
            }
        }

        private void BrowseForFolder(object sender, RoutedEventArgs eventArgs)
        {
            using (Forms.FolderBrowserDialog dialog = new Forms.FolderBrowserDialog())
            {
                dialog.Description = "Choose where Minova should be installed.";
                dialog.SelectedPath = Directory.Exists(InstallPath.Text)
                    ? InstallPath.Text
                    : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (dialog.ShowDialog() == Forms.DialogResult.OK)
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

        private void ShowFailure(Exception error)
        {
            BootstrapperEngine.WriteLog(error);
            MessageBox.Show(
                this,
                error.Message + Environment.NewLine + Environment.NewLine
                    + "No working Minova installation was removed.",
                "Minova Setup",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }

        private static Image Logo(double size)
        {
            Image image = new Image();
            image.Width = size;
            image.Height = size;
            image.Stretch = Stretch.Uniform;
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("minova.logo"))
            {
                if (stream != null)
                {
                    BitmapImage bitmap = new BitmapImage();
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = stream;
                    bitmap.EndInit();
                    bitmap.Freeze();
                    image.Source = bitmap;
                }
            }
            return image;
        }

        private static Button CreateButton(string content, bool primary, double width)
        {
            Button button = new Button();
            button.Content = content;
            button.Width = width;
            button.Height = 40;
            button.Cursor = Cursors.Hand;
            button.FontSize = 13;
            button.FontWeight = FontWeights.SemiBold;
            button.Foreground = primary ? AccentInkBrush : BrushFrom("#dce6f2");
            button.Background = primary ? AccentBrush : BrushFrom("#111a26");
            button.BorderBrush = primary ? AccentBrush : BrushFrom("#35475e");
            button.BorderThickness = new Thickness(1);
            button.Template = ButtonTemplate();
            Brush normal = button.Background;
            Brush hover = primary ? AccentHoverBrush : BrushFrom("#172230");
            button.MouseEnter += delegate { button.Background = hover; };
            button.MouseLeave += delegate { button.Background = normal; };
            return button;
        }

        private static Button CreateTitleButton(bool close)
        {
            Button button = new Button();
            button.Width = 48;
            button.Height = 48;
            button.Background = Brushes.Transparent;
            button.BorderThickness = new Thickness(0);
            button.Cursor = Cursors.Arrow;
            button.Template = ButtonTemplate();

            Grid icon = new Grid();
            icon.Width = 14;
            icon.Height = 14;
            if (close)
            {
                Line first = new Line();
                first.X1 = 2;
                first.Y1 = 2;
                first.X2 = 12;
                first.Y2 = 12;
                first.Stroke = BrushFrom("#b9c6d6");
                first.StrokeThickness = 1;
                Line second = new Line();
                second.X1 = 12;
                second.Y1 = 2;
                second.X2 = 2;
                second.Y2 = 12;
                second.Stroke = BrushFrom("#b9c6d6");
                second.StrokeThickness = 1;
                icon.Children.Add(first);
                icon.Children.Add(second);
            }
            else
            {
                Line line = new Line();
                line.X1 = 2;
                line.Y1 = 8;
                line.X2 = 12;
                line.Y2 = 8;
                line.Stroke = BrushFrom("#b9c6d6");
                line.StrokeThickness = 1;
                icon.Children.Add(line);
            }
            button.Content = icon;
            button.MouseEnter += delegate { button.Background = close ? BrushFrom("#c9414d") : BrushFrom("#172333"); };
            button.MouseLeave += delegate { button.Background = Brushes.Transparent; };
            return button;
        }

        private static ControlTemplate ButtonTemplate()
        {
            ControlTemplate template = new ControlTemplate(typeof(Button));
            FrameworkElementFactory border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(6));
            border.SetBinding(Border.BackgroundProperty, new Binding("Background")
            {
                RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent)
            });
            border.SetBinding(Border.BorderBrushProperty, new Binding("BorderBrush")
            {
                RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent)
            });
            border.SetBinding(Border.BorderThicknessProperty, new Binding("BorderThickness")
            {
                RelativeSource = new RelativeSource(RelativeSourceMode.TemplatedParent)
            });
            FrameworkElementFactory presenter = new FrameworkElementFactory(typeof(ContentPresenter));
            presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(presenter);
            template.VisualTree = border;
            return template;
        }

        private static TextBlock Eyebrow(string value)
        {
            return Text(value, 11, AccentBrush, FontWeights.Bold);
        }

        private static TextBlock SummaryItem(string value)
        {
            TextBlock text = Text("\u2022  " + value, 11, BrushFrom("#8193a9"), FontWeights.Normal);
            text.Inlines.FirstInline.Foreground = BlueBrush;
            return text;
        }

        private static TextBlock Text(string value, double size, Brush brush, FontWeight weight)
        {
            TextBlock text = new TextBlock();
            text.Text = value;
            text.FontSize = size;
            text.Foreground = brush;
            text.FontWeight = weight;
            return text;
        }

        private static Brush BrushFrom(string value)
        {
            return (Brush)new BrushConverter().ConvertFromString(value);
        }
    }

    internal sealed class OptionToggle : Border
    {
        private readonly Border Mark;
        private readonly TextBlock Check;
        private readonly Brush Accent;
        internal bool IsChecked;

        internal OptionToggle(string title, string description, bool isChecked, Brush accent)
        {
            Accent = accent;
            IsChecked = isChecked;
            MinHeight = 51;
            Padding = new Thickness(10, 7, 10, 7);
            BorderBrush = Brushes.Transparent;
            BorderThickness = new Thickness(1);
            CornerRadius = new CornerRadius(6);
            Cursor = Cursors.Hand;

            Grid row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(29) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Child = row;

            Mark = new Border();
            Mark.Width = 17;
            Mark.Height = 17;
            Mark.HorizontalAlignment = HorizontalAlignment.Left;
            Mark.VerticalAlignment = VerticalAlignment.Center;
            Mark.CornerRadius = new CornerRadius(4);
            Mark.BorderThickness = new Thickness(1);
            Check = new TextBlock();
            Check.Text = "\u2713";
            Check.FontSize = 12;
            Check.FontWeight = FontWeights.Bold;
            Check.Foreground = InstallerWindowBrush("#041817");
            Check.HorizontalAlignment = HorizontalAlignment.Center;
            Check.VerticalAlignment = VerticalAlignment.Center;
            Mark.Child = Check;
            row.Children.Add(Mark);

            StackPanel copy = new StackPanel();
            Grid.SetColumn(copy, 1);
            TextBlock heading = new TextBlock();
            heading.Text = title;
            heading.FontSize = 13;
            heading.FontWeight = FontWeights.SemiBold;
            heading.Foreground = InstallerWindowBrush("#e4ecf6");
            copy.Children.Add(heading);
            TextBlock detail = new TextBlock();
            detail.Text = description;
            detail.Margin = new Thickness(0, 2, 0, 0);
            detail.FontSize = 11;
            detail.Foreground = InstallerWindowBrush("#7f92a9");
            copy.Children.Add(detail);
            row.Children.Add(copy);

            MouseLeftButtonUp += delegate
            {
                IsChecked = !IsChecked;
                RenderState();
            };
            MouseEnter += delegate
            {
                Background = InstallerWindowBrush("#101924");
                BorderBrush = InstallerWindowBrush("#233348");
            };
            MouseLeave += delegate
            {
                Background = Brushes.Transparent;
                BorderBrush = Brushes.Transparent;
            };
            RenderState();
        }

        private void RenderState()
        {
            Mark.Background = IsChecked ? Accent : InstallerWindowBrush("#0a111a");
            Mark.BorderBrush = IsChecked ? Accent : InstallerWindowBrush("#4c617a");
            Check.Visibility = IsChecked ? Visibility.Visible : Visibility.Hidden;
        }

        private static Brush InstallerWindowBrush(string value)
        {
            return (Brush)new BrushConverter().ConvertFromString(value);
        }
    }
}
