# Jarvis model routing

The router runs on the Windows panel host alongside Codex CLI. Home Assistant
connects using its Ollama integration, with URL `http://10.77.77.1:11435` and model
`jarvis-auto:latest`. HA continues to execute Assist and Daylight MCP tools. The
router only generates answers and requests for those tools; Codex's shell and
patch tools are disabled, its workspace is temporary and read-only, and user
Codex configuration is ignored. It uses the host user's existing Codex login.

## Verified diagnosis (2026-10-26)

- The live add-on is 1.1.9.39. Wake-word detection is listening.
- `conversation.family_assistant` is restored/unavailable. Its Ollama config
  entry is in `setup_retry` for `http://192.168.1.245:11434`, which is unreachable.
- `POST /api/conversation/process` with that agent returns HTTP 400:
  `Message format incorrect: invalid agent ID at 'agent_id'`.
- The Windows host runs Ollama with only `qwen2.5vl:3b`, the receipt reader.
  That is not a replacement for a tool-capable voice model.
- Codex CLI 0.155.1 is installed and logged in with ChatGPT. `gpt-6-luna` with
  low reasoning completed a live test. The schema-based adapter also produced a
  valid household `recall` request in approximately 4.1 seconds.
- Home Assistant's native conversation agent is present. It parses supported
  home commands; it is not a general-purpose LLM.
- The homelab project has a separate availability-aware batch-work router.
  Jarvis did not use it. Its current roster retires the old `qwen3.6` model and
  lists newer MLX models on the Macs. A documented roster is not proof that a
  particular endpoint or model is currently available.

The older Supervisor/STT HTTP 400 is already fixed in `index.js` by using the
Assist websocket speech stage. It is separate from this invalid-agent error.

## Routing behavior

1. Existing panel commands (volume, navigation, dimming) bypass the LLM.
2. Every 30 seconds, background checks probe Ollama, installed models and tool
   capabilities, plus Codex login, HTTPS reachability and its model catalog. No
   inference is generated and no inference tokens are consumed. Chat requests
   read the cached route directly, with no availability network calls. Snapshots
   expire after 90 seconds if the monitor stops updating.
3. Try `gpt-6-luna` and then `gpt-5.6-luna` through Codex CLI. Actual completed
   inference verifies access; being listed in a catalog does not.
4. Failed backends cool down for 60 seconds, then become eligible again.
   Each request has a total 25-second budget, with shorter backend timeouts.
5. If every backend fails, return an honest availability error. The add-on also
   skips unavailable HA agents and falls back to the native HA conversation
   agent when the selected agent is unavailable or rejected with 400/404.
   This keeps supported home commands working and explains the limitation for
   general questions. It does not replay ambiguous timed-out household actions.

`GET /health` reports `nextRoute`, the last successful route, probe timestamps,
readiness basis, and observed backend failures. Login/network/catalog readiness
cannot guarantee cloud quota or model entitlement; only a completed inference
verifies those, and failures immediately put that provider on cooldown.
Catalog responses describe the router alias, not guaranteed inference uptime.
History remains with HA and is included when the backend changes. No request
text, credentials or tool results are written by the router's logger.

Local Ollama and Whisper/Piper need no cloud API key. Codex needs a valid login
and available plan quota, and runs cloud inference even though its CLI runs on
the Windows machine. It can consume subscription usage. An API-key-based Codex
login would instead require API credentials and billing.

## Deployment

1. Copy this directory to `C:\HAOS\jarvis-router` on the panel host. Run
   `install-jarvis-router.ps1` from an elevated PowerShell with script execution
   allowed for that invocation. It creates `jarvis-router.json` from the example
   only if no configuration exists. Set `codexJs` to the installed Codex JS entry
   point, and configure local URLs/model IDs from actual live inventories.
2. The installer registers `Daylight-JarvisRouter` under the existing interactive
   user, at logon and every five minutes, with duplicate instances suppressed.
   Its restart loop logs to `C:\HAOS\jarvis-router\router.log`. The process runs
   with limited privileges. The listener binds to HA-Link only, and both the
   firewall admits only the HA VM (`10.77.77.2`); the server also allows the
   host itself for diagnostics.
3. Add a new HA Ollama integration at the router URL. Add a conversation agent
   named **Jarvis**, selecting `jarvis-auto:latest`, `think: false`, and the
   existing Assist and Daylight MCP LLM APIs. Preserve the Family Assistant's
   household instructions, particularly recall-before-guessing.
4. Set the preferred Assist pipeline's conversation engine and Daylight Voice
   settings to the resulting `conversation.jarvis` entity (verify the actual
   entity ID). Keep Whisper, Piper, wake word and prefer-local-intents enabled.
5. Release the add-on's voice fallback change using the normal add-on update
   process. The host gateway is deployed independently of the add-on image.
6. Verify the real HA conversation endpoint, a read-only household tool question,
   a spoken question from the panel, and recovery after a simulated backend
   failure. Confirm `/health` shows the provider that actually answered.

Rollback: select the prior HA conversation agent/pipeline, stop and disable the
`Daylight-JarvisRouter` task, and remove its named firewall rule. Existing receipt
Ollama, Whisper/Piper and panel services are independent of this router.

## Live deployment (2026-10-26)

The service is installed at `C:\HAOS\jarvis-router`, task
`Daylight-JarvisRouter`, bound to `10.77.77.1:11435`. Its background monitor
currently chooses `codex:gpt-6-luna`; the configured Mac models are unreachable.
The HA Ollama entry is `01M5W403MHSAKFD4Z93W7HMHTZ`, with Assist and
`mcp-01M3SKMVE5KPN2BMJYCNRQ0FS6` tools enabled.

Jarvis owns the existing `conversation.family_assistant` entity ID, preserving
Daylight settings and external references. The previous unavailable agent was
retained as `conversation.family_assistant_legacy`. The preferred Assist
pipeline uses the preserved ID with Whisper, Piper and local intents retained.
Add-on 1.1.9.41 is installed and running. Live checks: arithmetic through HA
in 4.6 seconds; a household list question successfully executed Daylight tools
and answered in 14.4 seconds. A recorded question through the live add-on
completed transcription, Jarvis inference and Piper reply audio in 6.7 seconds.

## Tests

Run `node scripts/test-jarvis-router.js` and `node scripts/test-voice.js` from the
add-on directory. They cover local preference, missing/tool-incompatible models,
provider failures, cooldown and recovery, timeouts, validated tool names, Ollama
stream framing, unavailable HA agents and the invalid-agent HTTP 400 regression.
