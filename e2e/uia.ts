import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * What Windows hands a screen reader.
 *
 * Narrator, NVDA and JAWS do not read the page: they read the accessibility
 * tree the browser engine publishes, through UI Automation. WebDriver and axe
 * see the DOM; this sees the published tree, from outside the process, the way
 * an assistive technology does.
 *
 * It is not a person listening. It proves each element is exposed with the
 * name and type a reader would announce, and that focus lands where the keys
 * say. What it sounds like, in what order and how often, is still a person's
 * to judge.
 */

export interface UiaNode {
  /** The accessible name a reader announces. */
  name: string;
  /** The UI Automation control type, e.g. `ControlType.DataItem`. */
  type: string;
  /** How the type is said aloud, e.g. `button`. */
  says: string;
}

function powershell(script: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      // Encoded, because a script of many lines does not survive a command line.
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`UI Automation failed: ${stderr.slice(0, 600)}`));
        else resolve(stdout);
      },
    );
  });
}

/**
 * The binary under test, and only that one: a person may have an installed Tessera
 * open beside the suite, and its window is theirs to keep and not what is being read.
 */
const UNDER_TEST = path.resolve(
  process.env.TESSERA_E2E_APP ??
    path.join(import.meta.dirname, '..', 'src-tauri', 'target', 'debug', 'tessera.exe'),
);

const PRELUDE = `
$ErrorActionPreference = 'Stop';
$ProgressPreference = 'SilentlyContinue';
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes;
$auto = [System.Windows.Automation.AutomationElement];
function Describe($e) {
  $c = $e.Current;
  [pscustomobject]@{ name = [string]$c.Name; type = [string]$c.ControlType.ProgrammaticName; says = [string]$c.LocalizedControlType };
}
$proc = Get-Process tessera -ErrorAction Stop | Where-Object { $_.Path -eq '${UNDER_TEST.replace(/'/g, "''")}' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
`;

/** Every named element in the application's published accessibility tree. */
export async function publishedTree(): Promise<UiaNode[]> {
  const out = await powershell(`${PRELUDE}
$window = $auto::FromHandle($proc.MainWindowHandle);
$all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition);
$rows = foreach ($e in $all) { $d = Describe $e; if ($d.name -ne '') { $d } };
ConvertTo-Json -Compress -InputObject @($rows)`);
  return JSON.parse(out.trim() === '' ? '[]' : out) as UiaNode[];
}

/** What the system says has keyboard focus right now. */
export async function focusedElement(): Promise<UiaNode> {
  const out = await powershell(`${PRELUDE}
ConvertTo-Json -Compress -InputObject (Describe $auto::FocusedElement)`);
  return JSON.parse(out) as UiaNode;
}

/** Bring the application's window to the front, so it can hold system focus. */
export async function focusWindow(): Promise<void> {
  await powershell(`${PRELUDE}
[void](New-Object -ComObject WScript.Shell).AppActivate($proc.Id);`);
}
