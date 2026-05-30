import { strToU8, zipSync } from "fflate";
import PDFDocument from "pdfkit";
import { buildAnalytics, buildLeaderboard } from "./domain.js";

export function toCsvRows(event) {
  const rows = [
    ["Section", "Title", "Name", "Value", "Votes", "Answered", "Created"],
    ...event.questions.map((question) => [
      "Q&A",
      question.text,
      question.anonymous ? "Anonymous" : question.name,
      "",
      question.upvotes.length,
      question.answered ? "Yes" : "No",
      question.createdAt,
    ]),
  ];

  event.polls.forEach((poll) => {
    poll.responses.forEach((response) => {
      rows.push(["Poll", poll.title, response.name || "Anonymous", response.value, "", "", response.createdAt]);
    });
  });

  event.quizzes.forEach((quiz) => {
    quiz.answers.forEach((answer) => {
      const question = quiz.questions.find((item) => item.id === answer.questionId);
      rows.push([
        "Quiz",
        question?.text || quiz.title,
        answer.name || "Anonymous",
        question?.options[answer.answerIndex] || answer.answerIndex,
        answer.correct ? "Correct" : "Incorrect",
        answer.points,
        answer.createdAt,
      ]);
    });
  });

  return rows;
}

export function sendCsv(res, event) {
  const csv = toCsvRows(event)
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${event.code}-engagement.csv"`);
  res.send(csv);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function makeXlsxBuffer(sheets) {
  const sheetContentTypes = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const workbookRelationships = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");

  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetContentTypes}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationships}
</Relationships>`),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows));
  });

  return Buffer.from(zipSync(files));
}

export function sendXlsx(res, event) {
  const analytics = buildAnalytics(event);
  const buffer = makeXlsxBuffer([
    {
      name: "Summary",
      rows: [
        ["Event", "Code", "Participants", "Questions", "Poll responses", "Quiz answers", "Engagement score"],
        [
          event.title,
          event.code,
          analytics.participants,
          analytics.questions,
          analytics.pollResponses,
          analytics.quizAnswers,
          analytics.engagementScore,
        ],
      ],
    },
    {
      name: "Q&A",
      rows: [
        ["Question", "Name", "Upvotes", "Answered", "Pinned", "Created"],
        ...event.questions.map((question) => [
          question.text,
          question.anonymous ? "Anonymous" : question.name,
          question.upvotes.length,
          question.answered ? "Yes" : "No",
          question.pinned ? "Yes" : "No",
          question.createdAt,
        ]),
      ],
    },
    {
      name: "Polls",
      rows: [
        ["Poll", "Type", "Respondent", "Response", "Created"],
        ...event.polls.flatMap((poll) =>
          poll.responses.map((response) => [
            poll.title,
            poll.type,
            response.name || "Anonymous",
            response.value,
            response.createdAt,
          ]),
        ),
      ],
    },
    {
      name: "Quiz leaderboard",
      rows: [
        ["Quiz", "Rank", "Name", "Score", "Correct", "Answers"],
        ...event.quizzes.flatMap((quiz) =>
          buildLeaderboard(quiz).map((row) => [quiz.title, row.rank, row.name, row.score, row.correct, row.answers]),
        ),
      ],
    },
  ]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${event.code}-engagement.xlsx"`);
  res.send(buffer);
}

export function sendPdf(res, event) {
  const analytics = buildAnalytics(event);
  const doc = new PDFDocument({ margin: 44 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${event.code}-report.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).text(`${event.title} engagement report`);
  doc.moveDown(0.3).fontSize(11).fillColor("#526173").text(`Event code: ${event.code}`);
  doc.moveDown(1).fillColor("#111827").fontSize(13).text("Summary", { underline: true });
  [
    `Participants: ${analytics.participants}`,
    `Questions: ${analytics.questions}`,
    `Poll responses: ${analytics.pollResponses}`,
    `Quiz answers: ${analytics.quizAnswers}`,
    `Engagement score: ${analytics.engagementScore}`,
  ].forEach((line) => doc.moveDown(0.35).fontSize(11).text(line));

  doc.moveDown(1).fontSize(13).text("Top questions", { underline: true });
  analytics.topQuestions.forEach((question, index) => {
    doc
      .moveDown(0.45)
      .fontSize(10.5)
      .text(`${index + 1}. ${question.text} (${question.upvotes.length} votes)`);
  });

  doc.moveDown(1).fontSize(13).text("Poll summaries", { underline: true });
  analytics.pollSummaries.forEach((poll) => {
    doc.moveDown(0.5).fontSize(10.5).text(`${poll.title} - ${poll.responseCount} responses`);
    if (poll.average) doc.fontSize(9).fillColor("#526173").text(`Average: ${poll.average}`).fillColor("#111827");
  });

  doc.end();
}

