import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * -------------------------------------------------------------
 * UNIE BUDDY PDF EXPORT TYPES
 * -------------------------------------------------------------
 */

export type PDFArticle = {
  id?: string;

  title: string;

  content?: string | null;
  summary?: string | null;

  subject?: string | null;
  gs_paper?: string | null;

  topics?: string[] | null;

  upsc_relevance_score?: number | null;
  upsc_reasoning?: string | null;

  is_hot_topic?: boolean | null;
};

export type PDFMCQ = {
  id?: string;

  article_id?: string;

  question: string;

  options: string[];

  correct_answer?: string | null;

  correct_index?: number | null;

  explanation?: string | null;

  difficulty?: string | null;

  topic?: string | null;
};

export type NewspaperPDFData = {
  newspaperName?: string;

  date?: string;

  articles: PDFArticle[];

  mcqs?: PDFMCQ[];
};
/**
 * -------------------------------------------------------------
 * PDF TEXT SANITIZER
 * Removes unsupported Unicode/control characters that can cause
 * broken spacing or separated words in jsPDF built-in fonts.
 * -------------------------------------------------------------
 */

function sanitizePdfText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    // Normalize Unicode characters
    .normalize("NFKC")

    // Replace different types of hyphens/dashes with normal hyphen
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")

    // Replace smart quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')

    // Replace ellipsis
    .replace(/\u2026/g, "...")

    // Remove soft hyphen
    .replace(/\u00AD/g, "")

    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, "")

    // Remove ASCII control characters except normal whitespace
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")

    // Convert non-breaking spaces into normal spaces
    .replace(/\u00A0/g, " ")

    // Collapse repeated spaces
    .replace(/[ \t]+/g, " ")

    // Clean spaces around line breaks
    .replace(/ *\n */g, "\n")

    .trim();
}
/**
 * -------------------------------------------------------------
 * TEXT WRAPPING HELPER
 * -------------------------------------------------------------
 */

function addWrappedText(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 6,
): number {
  const cleanedText = sanitizePdfText(text);

  const lines = pdf.splitTextToSize(
    cleanedText,
    maxWidth,
  );

  const pageHeight =
    pdf.internal.pageSize.getHeight();

  const bottomMargin = 22;
  const topMargin = 20;

  for (const line of lines) {
    // If the next line would enter the footer area,
    // create a new page first.
    if (
      y + lineHeight >
      pageHeight - bottomMargin
    ) {
      pdf.addPage();
      y = topMargin;
    }

    pdf.text(
      line,
      x,
      y,
    );

    y += lineHeight;
  }

  return y;
}


/**
 * -------------------------------------------------------------
 * PAGE BREAK HELPER
 * -------------------------------------------------------------
 */



function ensurePageSpace(
  pdf: jsPDF,
  y: number,
  requiredSpace = 30,
): number {
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Keep enough empty space for the footer.
  const bottomMargin = 22;

  if (y + requiredSpace > pageHeight - bottomMargin) {
    pdf.addPage();

    // Consistent top margin on every new page.
    return 20;
  }

  return y;
}


/**
 * -------------------------------------------------------------
 * MAIN PDF GENERATOR
 * -------------------------------------------------------------
 */

export function generateNewspaperPDF(
  data: NewspaperPDFData,
): void {
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
  });

  const pageWidth =
    pdf.internal.pageSize.getWidth();

  let y = 20;


  /**
   * -----------------------------------------------------------
   * COVER HEADER
   * -----------------------------------------------------------
   */

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);

  pdf.text(
    "UNIE BUDDY",
    pageWidth / 2,
    y,
    {
      align: "center",
    },
  );

  y += 10;

  pdf.setFontSize(14);

  pdf.text(
    "Daily Newspaper Analysis & MCQs",
    pageWidth / 2,
    y,
    {
      align: "center",
    },
  );

  y += 12;


  /**
   * Newspaper information
   */

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  if (data.newspaperName) {
    pdf.text(
      `Newspaper: ${data.newspaperName}`,
      15,
      y,
    );

    y += 6;
  }

  if (data.date) {
    pdf.text(
      `Date: ${data.date}`,
      15,
      y,
    );

    y += 6;
  }


  /**
   * -----------------------------------------------------------
   * ARTICLE SECTION
   * -----------------------------------------------------------
   */

  y += 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);

  pdf.text(
    "NEWSPAPER ANALYSIS",
    15,
    y,
  );

  y += 10;


  data.articles.forEach(
    (article, index) => {
      y = ensurePageSpace(
        pdf,
        y,
        50,
      );

      /**
       * Article number
       */

      pdf.setFont(
        "helvetica",
        "bold",
      );

      pdf.setFontSize(14);

      pdf.text(
        `ARTICLE ${index + 1}`,
        15,
        y,
      );

      y += 8;


      /**
       * Title
       */

      pdf.setFontSize(12);

      y = addWrappedText(
  pdf,
  sanitizePdfText(article.title),
  15,
  y,
  pageWidth - 30,
);

      y += 4;


      /**
       * Metadata
       */

      pdf.setFont(
        "helvetica",
        "normal",
      );

      pdf.setFontSize(9);

     const metadata = [
  article.subject
    ? `Subject: ${sanitizePdfText(article.subject)}`
    : null,

  article.gs_paper
    ? `GS Paper: ${sanitizePdfText(article.gs_paper)}`
    : null,

  article.upsc_relevance_score !== undefined &&
  article.upsc_relevance_score !== null
    ? `UPSC Relevance: ${article.upsc_relevance_score}/100`
    : null,

  article.is_hot_topic
    ? "Hot Topic: Yes"
    : null,
]
  .filter(Boolean)
  .join(" | ");

      if (metadata) {
        y = addWrappedText(
          pdf,
          metadata,
          15,
          y,
          pageWidth - 30,
        );

        y += 4;
      }


      /**
       * Topics
       */

      if (
        article.topics &&
        article.topics.length > 0
      ) {
        pdf.setFont(
          "helvetica",
          "bold",
        );

        pdf.text(
          "Topics:",
          15,
          y,
        );

        pdf.setFont(
          "helvetica",
          "normal",
        );

        y = addWrappedText(
          pdf,
          sanitizePdfText(article.topics.join(", ")),
          32,
          y,
          pageWidth - 47,
        );

        y += 4;
      }


      /**
       * Summary
       */

      if (article.summary) {
        y = ensurePageSpace(
          pdf,
          y,
          30,
        );

        pdf.setFont(
          "helvetica",
          "bold",
        );

        pdf.text(
          "Summary:",
          15,
          y,
        );

        y += 6;

        pdf.setFont(
          "helvetica",
          "normal",
        );

     y = addWrappedText(
  pdf,
  sanitizePdfText(article.summary),
  15,
  y,
  pageWidth - 30,
);

        y += 5;
      }


      /**
       * Article content
       */

      if (article.content) {
        y = ensurePageSpace(
          pdf,
          y,
          30,
        );

        pdf.setFont(
          "helvetica",
          "bold",
        );

        pdf.text(
          "Detailed Analysis:",
          15,
          y,
        );

        y += 6;

        pdf.setFont(
          "helvetica",
          "normal",
        );

        y = addWrappedText(
  pdf,
  sanitizePdfText(article.content),
  15,
  y,
  pageWidth - 30,
);

        y += 5;
      }


      /**
       * UPSC Reasoning
       */

      if (article.upsc_reasoning) {
        y = ensurePageSpace(
          pdf,
          y,
          25,
        );

        pdf.setFont(
          "helvetica",
          "bold",
        );

        pdf.text(
          "Why Important for UPSC:",
          15,
          y,
        );

        y += 6;

        pdf.setFont(
          "helvetica",
          "normal",
        );

       y = addWrappedText(
  pdf,
  sanitizePdfText(article.upsc_reasoning),
  15,
  y,
  pageWidth - 30,
);

        y += 8;
      }


      /**
       * Divider
       */

      y = ensurePageSpace(
        pdf,
        y,
        10,
      );

      pdf.line(
        15,
        y,
        pageWidth - 15,
        y,
      );

      y += 10;
    },
  );


  /**
   * -----------------------------------------------------------
   * MCQ SECTION
   * -----------------------------------------------------------
   */

  if (
    data.mcqs &&
    data.mcqs.length > 0
  ) {
    pdf.addPage();

    y = 20;

    pdf.setFont(
      "helvetica",
      "bold",
    );

    pdf.setFontSize(18);

    pdf.text(
      "UPSC PRACTICE MCQs",
      15,
      y,
    );

    y += 12;


    data.mcqs.forEach(
      (mcq, index) => {
        y = ensurePageSpace(
          pdf,
          y,
          50,
        );

        pdf.setFont(
          "helvetica",
          "bold",
        );

        pdf.setFontSize(11);

        y = addWrappedText(
          pdf,
         `Q${index + 1}. ${sanitizePdfText(mcq.question)}`,
          15,
          y,
          pageWidth - 30,
        );

        y += 5;


        /**
         * Options
         */

        pdf.setFont(
          "helvetica",
          "normal",
        );

        pdf.setFontSize(10);

        mcq.options.forEach(
          (
            option,
            optionIndex,
          ) => {
            const letters = [
              "A",
              "B",
              "C",
              "D",
              "E",
            ];

            y = ensurePageSpace(
              pdf,
              y,
              15,
            );

          const optionText = sanitizePdfText(option);

const optionLines = pdf.splitTextToSize(
  `${letters[optionIndex]}. ${optionText}`,
  pageWidth - 40,
);

const optionHeight = optionLines.length * 5 + 3;

y = ensurePageSpace(
  pdf,
  y,
  optionHeight + 5,
);

pdf.text(
  optionLines,
  20,
  y,
);

y += optionLines.length * 5 + 3;

          },
        );


        /**
         * Correct Answer
         */

        if (mcq.correct_answer) {
          y += 3;

          pdf.setFont(
            "helvetica",
            "bold",
          );

          y = addWrappedText(
            pdf,
            `Correct Answer: ${sanitizePdfText(mcq.correct_answer)}`,
            15,
            y,
            pageWidth - 30,
          );

          y += 4;
        }


        /**
         * Explanation
         */

        if (mcq.explanation) {
  y = ensurePageSpace(
    pdf,
    y,
    35,
  );

  pdf.setFont(
    "helvetica",
    "bold",
  );

          pdf.text(
            "Explanation:",
            15,
            y,
          );

          y += 6;

          pdf.setFont(
            "helvetica",
            "normal",
          );

          y = addWrappedText(
            pdf,
           sanitizePdfText(mcq.explanation),
            15,
            y,
            pageWidth - 30,
          );

          y += 8;
        }


        pdf.line(
          15,
          y,
          pageWidth - 15,
          y,
        );

        y += 10;
      },
    );
  }


  /**
   * -----------------------------------------------------------
   * PAGE NUMBERS
   * -----------------------------------------------------------
   */

  const totalPages =
    pdf.getNumberOfPages();

  for (
    let page = 1;
    page <= totalPages;
    page++
  ) {
    pdf.setPage(page);

    pdf.setFontSize(8);

    pdf.setFont(
      "helvetica",
      "normal",
    );

    pdf.text(
  `UNIE BUDDY | Page ${page} of ${totalPages}`,
  pageWidth / 2,
  pdf.internal.pageSize.getHeight() - 8,
  {
    align: "center",
  },
);
  }


  /**
   * -----------------------------------------------------------
   * SAVE PDF
   * -----------------------------------------------------------
   */

  const safeDate =
    data.date ||
    new Date()
      .toISOString()
      .split("T")[0];

  pdf.save(
    `UNIE_BUDDY_Newspaper_${safeDate}.pdf`,
  );
}