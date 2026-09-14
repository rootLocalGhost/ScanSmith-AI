# 📊 Gemini API Quota, Rate Limits & Token Analytics

ScanSmith AI Studio includes a built-in **API Quota & Usage Monitor** to provide complete transparency into your Google Gemini API consumption, rate limit ceilings, daily resets, and token costs.

---

## 1. Rate Limit Tiers & Model Specifications

Google Gemini API limits depend on the specific model selected in the **AI Presets** tab:

| Model ID | Display Name | Tier | Requests Per Day (RPD) | Requests Per Minute (RPM) | Token Limit / Req |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Free | **1,500 RPD** | **15 RPM** | 1,000,000 |
| `gemini-3.7-flash` | Gemini 3.7 Flash | Free | **1,500 RPD** | **15 RPM** | 1,000,000 |
| `gemini-3.5-flash` | Gemini 3.5 Flash | Free | **1,500 RPD** | **15 RPM** | 1,000,000 |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | Free | **1,500 RPD** | **30 RPM** | 1,000,000 |
| `gemini-pro-latest` | Gemini Pro Latest | Paid | **50 RPD** | **2 RPM** | 2,000,000 |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | Paid | **50 RPD** | **2 RPM** | 2,000,000 |

> [!NOTE]
> When switching models in the dropdown, the Quota Monitor automatically updates the active ceiling and rate limits to match the selected model.

---

## 2. Daily Reset Window (Midnight Pacific Time)

Google Gemini API daily quotas do not reset at your local midnight; they reset at **Midnight Pacific Time (`America/Los_Angeles`)**.

### Automated Rollover Logic
ScanSmith AI Studio calculates the current date in the Pacific timezone:
```typescript
const getPacificDateString = () => {
  const now = new Date();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
};
```
- When the date string advances across midnight Pacific Time, the daily request counter and token metrics automatically roll over to zero.
- The UI displays a live countdown: `🕒 Resets ~Xh (Midnight PT)`.

---

## 3. Real-Time Token Tracking via Rust Backend

When processing document pages, the Rust backend parses the official `usageMetadata` field returned by the Google Gemini REST API:

```json
{
  "usageMetadata": {
    "promptTokenCount": 1248,
    "candidatesTokenCount": 680,
    "totalTokenCount": 1928
  }
}
```

The Rust pipeline aggregates these counts across all multi-page document chunks and returns the verified token totals to the frontend, ensuring complete accuracy.

---

## 4. UI Monitoring Interfaces

ScanSmith AI Studio features a dual-interface monitoring design:

### 4.1 Sleek Mini Footer Ticker
- Permanently pinned at the bottom of the left sidebar across all tabs.
- Height: `26px` (zero wasted screen space).
- Displays live request totals, tokens consumed today, and tier badge.
- Clicking the ticker instantly opens the dedicated Quota tab.

### 4.2 Dedicated `📊 Quota` Analytics Tab
Located in the top tab navigation bar, providing:
- **Requests Gauge**: Shows consumed vs available requests (e.g., `14 / 1,500 reqs today (1,486 left)`).
- **Color-Coded Progress Track**:
  - 🟢 **Green**: `< 75%` quota consumed.
  - 🟠 **Orange**: `75% - 90%` quota consumed.
  - 🔴 **Red**: `> 90%` quota consumed.
- **Token Breakdown**: Separate metrics for Prompt Tokens and Candidate Tokens.
- **Direct Link**: One-click `AI Studio ↗` button to view billing, organization tiers, and plan info directly on Google's dashboard.
