# ARGUS

ARGUS is a real-time AI safety inspection platform built on the Gemini Live API. It maintains a persistent bidirectional stream of audio and video, reasons about the environment against swappable inspection rule sets, annotates hazards with AR overlays, and speaks findings back to the operator — all with sub-second latency and native interruption support.

Built for the **Gemini Live Agent Challenge** · Category: **Live Agents**

---

## How It Works

1. Open ARGUS on any device — phone, desktop, or AR headset. The interface auto-configures for your environment.
2. Select an inspection module (or let ARGUS detect the context automatically).
3. Say **"argus"** or tap **Inspect** to begin. ARGUS opens a persistent bidirectional stream to Gemini Live.
4. Point the camera. ARGUS streams frames and audio continuously, reasoning against the active rule set in real time.
5. Hazards are announced aloud, annotated on screen, and logged to the session. Ask questions, redirect the camera, switch modes — all by voice.
6. Say **"report"** when done. ARGUS generates a structured inspection report with every finding, timestamp, camera ID, and spatial location.

---

## Use Cases

**1. Pre-shift construction site walkthrough**
A site supervisor puts on AR glasses and walks the perimeter before crews arrive. ARGUS watches through the camera, calls out a missing fall-arrest anchor on scaffold level 3, flags an unsecured load on the materials hoist, and logs both with timestamps. The supervisor never stops walking or touches a screen.

**2. Fleet pre-trip inspection**
A truck driver holds up their phone and slowly pans around the vehicle. ARGUS checks tire sidewalls, brake hoses, glad-hand seals, USDOT markings, and the CVSA decal — 45 rules in seconds. It speaks "left rear tire sidewall shows a visible bulge, critical severity" and flags it in the report before the driver reaches the cab door.

**3. Hospital compliance monitoring via fixed CCTV**
A facilities team connects three corridor cameras to the CCTV interface. ARGUS monitors all feeds simultaneously, alerting when a fire door is propped open, when a crash cart is blocking an egress path, or when a medical gas cylinder is unsecured — without any human watching the screens.

**4. Restaurant kitchen health inspection**
An environmental health officer opens ARGUS on their phone, selects the `kitchen` module, and walks the line. ARGUS flags a sanitiser bucket below required concentration, a cutting board stored above raw meat, and a missing date label on a prep container — each with the applicable FDA Food Code citation spoken aloud and captured in the report.

**5. School security sweep**
A resource officer does a morning walkthrough with the `school` module active. ARGUS watches for unattended bags near exits, propped exterior doors, unsecured equipment that could serve as a blunt weapon, and any object matching firearm profile — flagging anomalies immediately and logging location and timestamp for the incident record.

---

## The Problem

Safety inspections are slow, manual, and reactive. An inspector walks a site, documents what they see, and produces a report hours later. By then, the window to prevent an incident has closed.

ARGUS makes inspection continuous, conversational, and immediate. Point any camera — a phone, a fixed CCTV feed, an AR headset — and the agent begins watching, reasoning, and reporting in real time. It adapts its detection rules to the environment it's in, speaks hazard alerts aloud, and can be directed entirely by voice.

---

## Capabilities

| Feature | Detail |
|---|---|
| Real-time hazard detection | JPEG frames streamed to Gemini Live at up to 2 fps |
| Bidirectional voice | Raw PCM audio streamed in both directions; Gemini responds in speech |
| Interruption handling | Mid-response user speech immediately cancels the current output |
| Wake word activation | Say **"argus"** to start or stop an inspection hands-free |
| AR hazard overlays | Severity-coloured rings rendered over the live camera feed |
| Swappable rule modules | 20 industry-specific inspection rule sets — hot-switchable mid-session |
| Voice commands | `inspect` · `stop` · `status` · `report` |
| Report generation | Full inspection reports exported as JSON or PDF |
| Adaptive interface | Auto-detects context and renders the right UI: Smartphone / CCTV / AR |

---

## Interface Modes

ARGUS detects the device and environment on load and renders one of three purpose-built interfaces — no configuration required.

**Smartphone** — Full-screen camera viewfinder with a pull-up hazard sheet. Designed for fieldwork and handheld inspection.

**CCTV** — Multi-feed 2×2 grid with a sidebar showing risk level, hazard log, mode selector, and keyboard shortcuts. Designed for fixed monitoring stations.

**AR / Headset** — Completely invisible UI. The only visual element is a tiny indicator in the top-left corner: a spinning arc while processing, audio bars while speaking, nothing while idle. No dashboard, no buttons. The wearer controls everything by voice — the display is pure camera passthrough.

---

## Architecture

```mermaid
graph TB
    subgraph FE ["Frontend — Next.js 14 · TypeScript"]
        direction TB
        SM[Smartphone Session]
        CV[CCTV Session]
        AR[AR / Headset Session]
        SM & CV & AR --> HS[useArgusSession]
        HS --- WW[useWakeWord\nsay 'argus' to activate]
        HS --- VC[useVoiceCommands\ninspect · stop · status · report]
    end

    HS -->|"WebSocket wss://\nJPEG frames · PCM 16 kHz · control events"| WS

    subgraph CR ["Google Cloud Run — Go 1.24"]
        direction TB
        WS[WebSocket Server]
        WS --> AC[Agent Controller]
        AC --> VP[Vision Pipeline\nFrame Sampler · Event Engine]
        AC --> RE[Rule Engine\nModule Loader]
        AC --> IP[Intent Parser]
        AC --> RB[Report Builder\nJSON · PDF]
    end

    AC -->|"google.golang.org/genai SDK\nbidirectional stream"| GL

    subgraph GM ["Gemini Live API"]
        GL["gemini-2.5-flash-native-audio-preview\n─────────────────────────────\ninbound  → audio stream · JPEG frames\noutbound → audio · text · tool calls"]
    end

    subgraph GCP ["Google Cloud Platform"]
        CB[Cloud Build\ncloudbuild.yaml]
        AG[Artifact Registry\nDocker images]
        SEC[Secret Manager\nGEMINI_API_KEY]
        CB --> AG --> CR
        SEC -->|injected at runtime| CR
    end

    style FE fill:#0a0a0a,stroke:#2a2a2a,color:#f0f0f0
    style CR fill:#0a0a0a,stroke:#2a2a2a,color:#f0f0f0
    style GM fill:#0a0a0a,stroke:#FF5F1F,color:#f0f0f0
    style GCP fill:#050505,stroke:#1a1a1a,color:#7a7a7a
```

---

## Tech Stack

**Backend**
- Go 1.24
- `google.golang.org/genai` — official Google GenAI SDK
- Gemini Live API — `gemini-2.5-flash-native-audio-preview` (bidirectional stream)
- Gemini GenerateContent — `gemini-2.5-flash` (one-shot frame analysis fallback)
- Gorilla WebSocket

**Frontend**
- Next.js 14, TypeScript, Tailwind CSS
- Web Speech API — always-on wake word detection + voice commands
- Web Audio API — PCM audio capture and streaming
- WebXR — AR session detection
- Space Grotesk · Figtree · IBM Plex Mono

**Google Cloud**
- Cloud Run — backend hosting with WebSocket session affinity
- Cloud Build — automated container builds (`cloudbuild.yaml`)
- Artifact Registry — Docker image registry
- Secret Manager — secure API key storage

---

## Getting Started

### Prerequisites

- Go 1.24+
- Node.js 18+
- A Gemini API key — [get one at Google AI Studio](https://aistudio.google.com/app/apikey)

### Run locally

```bash
# 1. Clone and configure
git clone https://github.com/cutmob/ARgus
cd ARgus
cp .env.example .env
# Set GEMINI_API_KEY in .env

# 2. Backend
make run
# → http://localhost:8080
# → health: http://localhost:8080/api/v1/health

# 3. Frontend (separate terminal)
make frontend-install
make frontend-dev
# → http://localhost:3001
```

---

## Cloud Deployment

### Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated (`gcloud auth login`)
- A GCP project with billing enabled

### Deploy

```bash
make deploy PROJECT=your-gcp-project-id
```

The script handles everything end to end:

1. Enables Cloud Run, Cloud Build, Artifact Registry, and Secret Manager APIs
2. Creates the Artifact Registry repository
3. Prompts for your Gemini API key and stores it in Secret Manager — never written to disk or config files
4. Builds the Go container via Cloud Build — no Docker installation required locally
5. Deploys to Cloud Run with WebSocket session affinity and a 1-hour connection timeout
6. Outputs the live service URL

Once deployed, point the frontend at the backend:

```bash
# In frontend/web-client/.env.local
NEXT_PUBLIC_WS_URL=wss://your-service-url.run.app/ws
```

### CI/CD pipeline

```bash
# Submit a build manually via Cloud Build
make deploy-cloudbuild PROJECT=your-gcp-project-id

# Or connect the repository to a Cloud Build trigger in GCP Console
# — subsequent pushes to main will build and deploy automatically via cloudbuild.yaml
```

### View logs

```bash
make logs PROJECT=your-gcp-project-id
```

---

## Inspection Modules

Modules live in `./modules/`. Each is a self-contained directory:

| File | Purpose |
|---|---|
| `metadata.json` | Name, version, author, tags |
| `rules.json` | Hazard detection rules with severity levels |
| `prompt.txt` | System prompt injected into the Gemini Live session on start |

**20 built-in modules:**

`construction` · `facility` · `warehouse` · `manufacturing` · `electrical` · `kitchen` · `healthcare` · `refinery` · `laboratory` · `office` · `retail` · `hotel` · `school` · `datacenter` · `parking` · `elevator` · `loading-dock` · `cold-storage` · `rooftop` · `fleet`

To add a module:

```bash
make new-module NAME=warehouse
# Then edit modules/warehouse/rules.json and modules/warehouse/prompt.txt
```

Modules can be switched mid-session — the agent context updates immediately.

---

## WebSocket Protocol

All real-time communication between the frontend and backend runs over a single WebSocket connection at `/ws`.

**Client → Server**

```json
{ "type": "frame",  "data": "<base64 JPEG>" }
{ "type": "audio",  "data": "<base64 PCM, 16kHz mono, 16-bit LE>" }
{ "type": "event",  "event": "start_inspection", "mode": "construction" }
{ "type": "event",  "event": "stop_inspection" }
{ "type": "event",  "event": "generate_report",  "format": "pdf" }
```

**Server → Client**

```json
{ "type": "hazard",        "hazards": [...],  "overlays": [...] }
{ "type": "voice_response","text": "...",     "audio": "<base64 PCM>" }
{ "type": "overlay",       "overlays": [...] }
{ "type": "report",        "report": {...} }
{ "type": "error",         "message": "..." }
```

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/sessions` | List active sessions |
| `GET` | `/api/v1/sessions/:id` | Session details and hazard log |
| `GET` | `/api/v1/modules` | List available inspection modules |
| `POST` | `/api/v1/reports` | Generate a report for a session |
| `GET` | `/api/v1/reports/:id` | Retrieve a generated report |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `DEMO_TOKENS` | No | — | Comma-separated access codes (e.g. `ARGUS-DEMO1,ARGUS-SITE2`). Leave empty to disable the gate. |
| `PORT` | No | `8080` | HTTP listen port |
| `ARGUS_MODULES_DIR` | No | `./modules` | Path to inspection modules directory |
| `GEMINI_LIVE_MODEL` | No | `gemini-2.5-flash-native-audio-preview` | Override Live API model |
| `GEMINI_CONTENT_MODEL` | No | `gemini-2.5-flash` | Override GenerateContent model |
| `NEXT_PUBLIC_WS_URL` | No | `ws://localhost:8080/ws` | WebSocket backend URL for the frontend |

---

## Makefile Reference

| Target | Description |
|---|---|
| `make run` | Run backend locally |
| `make frontend-dev` | Run frontend dev server |
| `make build` | Compile Go binary |
| `make test` | Run Go tests |
| `make docker-build` | Build Docker image locally |
| `make deploy PROJECT=…` | Full Cloud Run deployment |
| `make deploy-cloudbuild PROJECT=…` | Trigger Cloud Build manually |
| `make logs PROJECT=…` | Stream Cloud Run logs |
| `make new-module NAME=…` | Scaffold a new inspection module |

---

## License

AGPL-3.0 with a commercial licensing option — see [LICENSE](LICENSE).
