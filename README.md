# Asta

An always-on, mostly-local voice assistant for Windows. Speech recognition and
speech synthesis run on this machine; the thinking step goes through OpenCode,
which also gives Asta tools (files, shell, web, and your Obsidian vault).

## How it works

```
 microphone
     |
     v
 wake engine  (whisper.cpp listening for "Asta", or Picovoice Porcupine)
     |
     v
 recorder     (energy endpointing: stops on silence)
     |
     v
 whisper.cpp  (local speech-to-text, CUDA on the RTX 3070)
     |
     v
 OpenCode     (agent "asta": full tools + Obsidian vault over MCP)
     |
     v
 Piper        (local text-to-speech)  ->  speakers
```

## Quick start

```powershell
cd C:\Users\akash\asta
node src\doctor.js          # check everything is installed
node src\asta.js            # start (uses wake.mode from config.json)
```

Or double-click `start-asta.bat` for a visible window.

## Commands

```powershell
node src\asta.js                      # run the assistant
node src\asta.js --mode manual        # press Enter to talk
node src\asta.js --mode whisper       # hands-free, no signup
node src\asta.js --mode porcupine     # hands-free, needs a Picovoice key
node src\asta.js --once "hello"       # one round-trip, prints and speaks
node src\doctor.js                    # environment check
node src\say.js "some words"          # just speak something
node src\asta-cli.js list             # reminders
node src\asta-cli.js remind "call mom" "in 20 minutes"
node src\asta-cli.js remember "I use metric"
node src\asta-cli.js recall "metric"
```

## Wake modes

| Mode | Notes |
| --- | --- |
| `whisper` | Default. No account needed. Listens locally and reacts to "Asta". Costs GPU time whenever there is speech in the room. |
| `porcupine` | Best accuracy and very low CPU. Needs a free Picovoice AccessKey and an `Asta.ppn` keyword file. See the vault guide. |
| `manual` | Press Enter to talk. Good for quiet rooms or testing. |

If `porcupine` is selected but not configured, Asta warns and starts in manual
mode rather than failing.

## Layout

```
config.json      settings (wake mode, thresholds, model, vault path)
src/             asta.js (daemon), stt.js, tts.js, brain.js, reminders.js, ...
models/          ggml-small.en.bin, Piper voice
bin/             whisper.cpp (CUDA + CPU), Piper
logs/            asta.log, download.log, extract.log
scripts/         download, extract, autostart helpers, test-mic
state/           current OpenCode session id
tmp/             scratch audio files
```

## Autostart

```powershell
powershell -File scripts\install-autostart.ps1     # start at logon (hidden)
powershell -File scripts\uninstall-autostart.ps1   # remove and stop
```

## Portal credentials (work in progress)

Asta is being extended to report SRM marks/attendance and Haveloc placement
notices. Credentials are stored locally and encrypted with the Windows Data
Protection API, so only the Windows account that created them can read them.
Nothing is written in plain text, and `secrets.json` is git-ignored.

```powershell
scripts\setup-credentials.bat     # masked prompt; encrypts and saves
```

`src/portals/secrets.js` handles encrypt/decrypt; `scripts/secure.ps1` is the
DPAPI helper it shells out to.

Caveat: Haveloc puts a reCAPTCHA in front of its login page, so a fully
unattended sign-in there is not possible — the first sign-in may need to be
completed by hand in a visible browser window.

## Notes

- Vault features need **Obsidian running**, because the vault tools are served
  by an Obsidian plugin. Everything else works without it.
- Reminders live in the vault: `Asta/Reminders.md` (readable) and
  `Asta/.asta/reminders.json` (machine copy).
- Asta drains the microphone while it speaks so it never hears itself.
- `bin\*.zip` are the original downloads and can be deleted to save ~680 MB.
