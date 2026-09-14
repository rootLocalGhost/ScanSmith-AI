# 📝 Gemini Multimodal OCR & Native DOCX Synthesis

ScanSmith AI Studio bridges deep computer vision restoration with cutting-edge Large Multimodal Models (LMMs) to synthesize structured, editable Microsoft Word (`.docx`) files directly from image scans.

---

## 1. Multimodal Prompt Architecture

Instead of traditional flat OCR engines (like basic Tesseract) that lose page layouts, equations, and hierarchy, ScanSmith AI Studio utilizes **Google Gemini** multimodal vision models (`gemini-2.5-flash`, `gemini-3.7-flash`, `gemini-3.1-pro-preview`, etc.).

### 1.1 Structural Extraction Rules
The model is prompted with rigorous structural extraction guidelines:
- **Heading Hierarchy**: Document titles mapped to `# Heading 1`, sections to `## Heading 2`, sub-sections to `### Heading 3`.
- **Equations & Math**:
  - Inline mathematics formatted as `$E = mc^2$`.
  - Complex display equations formatted in block LaTeX `$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$`.
- **Tables**: Markdown table format with pipe delimiters, preserving cell alignment and multi-line content.
- **Multilingual Unicode**: Preserves scripts without character corruption (including Bengali/Bangla, Arabic, Devanagari, and CJK).
- **Bangla Typography**: Formatted with standard Bengali typography rules using **Tiro Bangla** font rendering.

---

## 2. Document Presets

ScanSmith AI Studio includes fine-tuned extraction presets:

| Preset Name | Target Document | Extraction Focus |
| :--- | :--- | :--- |
| **Question Paper** | Academic Exams, Tests | Preserves question numbering, sub-questions `(a), (b)`, marks allocations `[4]`, math formulas, and two-column question layouts. |
| **Book Chapter** | Textbooks, Novels | Focuses on chapter titles, author headings, blockquotes, footnotes, continuous paragraph flow, and clean reading typography. |
| **Invoice & Receipt**| Financial Slips, Invoices | Extracts vendor details, line item tables with quantities/prices, sub-totals, taxes, and payment metadata. |
| **Legal Contract** | Agreements, Leases, Deeds | Formats clauses, numbered legal paragraphs, parties, signature blocks, and annexures. |
| **Custom OCR** | Free-form Documents | Allows custom user system prompts to direct extraction format and style. |

---

## 3. Native Word (`.docx`) Synthesis Engine

Unlike tools that convert HTML to PDF and then to DOCX (which creates fractured text boxes and broken margins), ScanSmith AI Studio constructs native **WordprocessingML (OOXML)** files directly in Rust using [`docx-rs`](https://github.com/bokuweb/docx-rs).

### 3.1 Document Hierarchy Mapping
```
Markdown AST Stream
       │
       ├─► Headings (H1/H2/H3) ────► w:p / w:pPr / w:pStyle (Heading1/2/3)
       │
       ├─► Paragraphs ─────────────► w:p / w:r / w:t (Calibri / Tiro Bangla)
       │
       ├─► LaTeX Math Expressions ──► Native Word Equation Objects / Formatted Runs
       │
       ├─► Tables ─────────────────► w:tbl / w:tr / w:tc (Bordered, Shaded, Padded)
       │
       └─► Lists & Bullet Points ──► w:p / w:numPr (Standardized Word Lists)
```

### 3.2 Dual Font Styling
- **Primary Latin Font**: `Calibri` / `Segoe UI` (11 pt text, 1.15 line spacing, 6 pt after paragraph).
- **Complex Script Font**: `Tiro Bangla` / `Vrinda` for Unicode South Asian text, ensuring proper rendering of conjunct consonants (*juktakkhors*).

---

## 4. AI Smart Filename Generation

When **AI Smart Name** (`✨`) is enabled:
1. Gemini inspects the primary heading and subject of the document during analysis.
2. It outputs a concise, semantic title (e.g., `Physics_Midterm_Exam_2026` or `Lease_Agreement_Green_Valley`).
3. The Rust backend cleanses the string:
   - Strips illegal filesystem characters (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`).
   - Replaces spaces with underscores.
   - Enforces a safe length ceiling (max 64 characters).

---

## 5. Dual-Storage & Collision-Free Persistence

Every synthesized `.docx` file is saved in two locations:

```
                  ┌───────────────────────────────┐
                  │   Synthesized Word Document   │
                  └──────────────┬────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       User Scan Directory              App History Archive
   (e.g., ~/Documents/Scans/)       (~/.config/scansmith_ai/history/)
                 │                               │
                 ▼                               ▼
      Immediate Local Access          Permanent Historic Copy
```

### Collision Resolution
If a file with the target name already exists:
- The engine checks for collisions without overwriting.
- Automatically increments a suffix: `Doc.docx` ➔ `Doc (1).docx` ➔ `Doc (2).docx`.
- The user never risks losing existing files.
