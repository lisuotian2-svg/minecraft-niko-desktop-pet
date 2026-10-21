using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace NikoFullscreen
{
    /// <summary>
    /// Lightweight foreground-fullscreen probe used by Niko Pet 3D.
    /// The Electron main process maps the reported monitor to an Electron
    /// display id; this helper only reports native Windows facts.
    /// </summary>
    public static class Probe
    {
        private const int GWL_STYLE = -16;
        private const int WS_MAXIMIZE = 0x01000000;
        private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        private const int DWMWA_CLOAKED = 14;
        private const uint MONITOR_DEFAULTTOPRIMARY = 1;

        private static int excludePid = -1;
        private static string[] excludeProcesses = new string[0];
        private static string[] excludeClasses = new string[0];
        private static bool dpiConfigured = false;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        public struct MONITORINFOEX
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szDevice;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);

        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr context);

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hWnd);

        public static void Configure(int pid, string processes, string classes)
        {
            excludePid = pid;
            excludeProcesses = SplitList(processes);
            excludeClasses = SplitList(classes);
            EnsureDpiAwareness();
        }

        private static string[] SplitList(string value)
        {
            if (string.IsNullOrEmpty(value)) return new string[0];
            string[] parts = value.Split(',');
            for (int i = 0; i < parts.Length; i++)
            {
                parts[i] = parts[i].Trim().ToLowerInvariant();
                if (parts[i].EndsWith(".exe")) parts[i] = parts[i].Substring(0, parts[i].Length - 4);
            }
            return parts;
        }

        private static void EnsureDpiAwareness()
        {
            if (dpiConfigured) return;
            dpiConfigured = true;
            try
            {
                // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
                if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware();
            }
            catch (Exception)
            {
                try { SetProcessDPIAware(); } catch (Exception) { }
            }
        }

        private static bool IsExcluded(int pid, string processName, string className)
        {
            if (pid == excludePid) return true;
            string lowerProcess = (processName ?? string.Empty).ToLowerInvariant();
            if (lowerProcess.EndsWith(".exe")) lowerProcess = lowerProcess.Substring(0, lowerProcess.Length - 4);
            for (int i = 0; i < excludeProcesses.Length; i++)
            {
                if (excludeProcesses[i].Length > 0 && lowerProcess == excludeProcesses[i]) return true;
            }
            string lowerClass = (className ?? string.Empty).ToLowerInvariant();
            for (int i = 0; i < excludeClasses.Length; i++)
            {
                if (excludeClasses[i].Length > 0 && lowerClass == excludeClasses[i]) return true;
            }
            return false;
        }

        private static string ProcessNameFor(int pid)
        {
            try { return Process.GetProcessById(pid).ProcessName + ".exe"; }
            catch (Exception) { return string.Empty; }
        }

        private static string ClassNameFor(IntPtr hwnd)
        {
            StringBuilder buffer = new StringBuilder(256);
            int written = GetClassName(hwnd, buffer, buffer.Capacity);
            return written > 0 ? buffer.ToString() : string.Empty;
        }

        private static bool TryGetVisibleBounds(IntPtr hwnd, out RECT rect)
        {
            try
            {
                RECT extended;
                int result = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out extended, Marshal.SizeOf(typeof(RECT)));
                if (result == 0 && extended.Right > extended.Left && extended.Bottom > extended.Top)
                {
                    rect = extended;
                    return true;
                }
            }
            catch (Exception) { }
            return GetWindowRect(hwnd, out rect);
        }

        private static bool IsCloaked(IntPtr hwnd)
        {
            try
            {
                int cloaked;
                int result = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int));
                return result == 0 && cloaked != 0;
            }
            catch (Exception) { return false; }
        }

        private static string RectJson(RECT rect)
        {
            return "{\"x\":" + rect.Left.ToString(CultureInfo.InvariantCulture)
                + ",\"y\":" + rect.Top.ToString(CultureInfo.InvariantCulture)
                + ",\"width\":" + (rect.Right - rect.Left).ToString(CultureInfo.InvariantCulture)
                + ",\"height\":" + (rect.Bottom - rect.Top).ToString(CultureInfo.InvariantCulture) + "}";
        }

        private static string JsonEscape(string value)
        {
            if (value == null) return string.Empty;
            StringBuilder builder = new StringBuilder(value.Length + 8);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == '"' || c == '\\') builder.Append('\\').Append(c);
                else if (c == '\n') builder.Append("\\n");
                else if (c == '\r') builder.Append("\\r");
                else if (c == '\t') builder.Append("\\t");
                else if (c < ' ') builder.Append('?');
                else builder.Append(c);
            }
            return builder.ToString();
        }

        private static string InactiveJson(string reason)
        {
            return "{\"kind\":\"state\",\"ts\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)
                + ",\"active\":false,\"reason\":\"" + JsonEscape(reason) + "\"}";
        }

        /// <summary>Capture one foreground-window snapshot as a compact JSON line.</summary>
        public static string JsonOnce()
        {
            EnsureDpiAwareness();
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return InactiveJson("no-foreground");

            uint pidValue;
            GetWindowThreadProcessId(hwnd, out pidValue);
            int pid = unchecked((int)pidValue);
            string processName = ProcessNameFor(pid);
            string className = ClassNameFor(hwnd);
            if (IsExcluded(pid, processName, className)) return InactiveJson("excluded");

            if (!IsWindowVisible(hwnd)) return InactiveJson("invisible");
            if (IsIconic(hwnd)) return InactiveJson("minimized");

            RECT visible;
            if (!TryGetVisibleBounds(hwnd, out visible)) return InactiveJson("no-bounds");
            int width = visible.Right - visible.Left;
            int height = visible.Bottom - visible.Top;
            if (width <= 0 || height <= 0) return InactiveJson("empty-bounds");

            IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
            MONITORINFOEX info = new MONITORINFOEX();
            info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
            if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return InactiveJson("no-monitor");

            int monitorWidth = info.rcMonitor.Right - info.rcMonitor.Left;
            int monitorHeight = info.rcMonitor.Bottom - info.rcMonitor.Top;
            bool maximized = (GetWindowLong(hwnd, GWL_STYLE) & WS_MAXIMIZE) != 0;
            bool cloaked = IsCloaked(hwnd);
            bool covers = !maximized && !cloaked
                && width >= monitorWidth * 0.98
                && height >= monitorHeight * 0.98
                && visible.Left <= info.rcMonitor.Left + 2
                && visible.Top <= info.rcMonitor.Top + 2;

            uint dpi = 96;
            try { dpi = GetDpiForWindow(hwnd); } catch (Exception) { }
            if (dpi == 0) dpi = 96;

            StringBuilder json = new StringBuilder(512);
            json.Append("{\"kind\":\"state\",\"ts\":").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture));
            json.Append(",\"active\":").Append(covers ? "true" : "false");
            json.Append(",\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"process\":\"").Append(JsonEscape(processName)).Append('"');
            json.Append(",\"className\":\"").Append(JsonEscape(className)).Append('"');
            json.Append(",\"maximized\":").Append(maximized ? "true" : "false");
            json.Append(",\"minimized\":false");
            json.Append(",\"cloaked\":").Append(cloaked ? "true" : "false");
            json.Append(",\"dpi\":").Append(dpi.ToString(CultureInfo.InvariantCulture));
            json.Append(",\"windowBounds\":").Append(RectJson(visible));
            json.Append(",\"monitor\":{\"device\":\"").Append(JsonEscape(info.szDevice ?? string.Empty)).Append('"');
            json.Append(",\"bounds\":").Append(RectJson(info.rcMonitor));
            json.Append(",\"workArea\":").Append(RectJson(info.rcWork)).Append("}}");
            return json.ToString();
        }
    }

    public static class Program
    {
        private static void Usage()
        {
            Console.Error.WriteLine("Usage: FullscreenWatcher.exe [--once] [--interval <ms>] [--exclude-pid <pid>] [--exclude-processes a,b] [--exclude-classes a,b]");
        }

        private static int ParseInt(string value, int fallback)
        {
            int parsed;
            return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }

        public static int Main(string[] args)
        {
            bool once = false;
            int interval = 500;
            int excludePid = -1;
            string processes = string.Empty;
            string classes = string.Empty;
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--once") once = true;
                else if (arg == "--interval" && i + 1 < args.Length) interval = Math.Max(100, ParseInt(args[++i], 500));
                else if (arg == "--exclude-pid" && i + 1 < args.Length) excludePid = ParseInt(args[++i], -1);
                else if (arg == "--exclude-processes" && i + 1 < args.Length) processes = args[++i];
                else if (arg == "--exclude-classes" && i + 1 < args.Length) classes = args[++i];
                else if (arg == "--help" || arg == "-h") { Usage(); return 0; }
            }

            Probe.Configure(excludePid, processes, classes);
            if (once)
            {
                Console.WriteLine(Probe.JsonOnce());
                Console.Out.Flush();
                return 0;
            }

            while (true)
            {
                try
                {
                    Console.WriteLine(Probe.JsonOnce());
                    Console.Out.Flush();
                }
                catch (Exception error)
                {
                    Console.WriteLine("{\"kind\":\"error\",\"message\":\"" + error.GetType().Name + "\"}");
                    Console.Out.Flush();
                }
                Thread.Sleep(interval);
            }
        }
    }
}
