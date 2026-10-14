/** What files HRMS accepts, with downloadable samples (served from /samples). */
export default function FormatHelp({ kind }: { kind: 'resume' | 'sheet' }) {
  if (kind === 'resume') return (
    <details className="small" style={{ border: '1px solid var(--line)', padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Accepted resume formats · download a sample</summary>
      <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
        <li><b>PDF</b> created from Word, Google Docs, Naukri/LinkedIn downloads etc. (has selectable text)</li>
        <li><b>DOCX</b> (Word 2007 or later) and <b>TXT</b></li>
        <li>Up to 5 MB each, up to 50 files at once</li>
        <li><b>Not accepted:</b> scanned or photographed resumes (image-only PDF, JPG, PNG) and old <b>.doc</b> files — save them as PDF or DOCX first</li>
        <li>Best results: name on the first line, then email | phone | city; sections for Skills, Experience, Education; CTC and notice period written as “Current CTC: 12 LPA”, “Notice period: 30 days”</li>
      </ul>
      <div className="row"><a className="btn o sm" href="/samples/Sample_Resume.pdf" download>Sample resume (PDF)</a><a className="btn o sm" href="/samples/Sample_Resume.docx" download>Sample resume (DOCX)</a></div>
    </details>
  );
  return (
    <details className="small" style={{ border: '1px solid var(--line)', padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Accepted spreadsheet format · download the template</summary>
      <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
        <li><b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> (UTF-8), up to 20 MB. Only the <b>first sheet</b> is read.</li>
        <li><b>Row 1 = column names.</b> Any names and order work — you map them below — but the template’s names map automatically.</li>
        <li><b>Required:</b> Full Name, plus Email or Phone. Other rows are skipped and reported.</li>
        <li>Phone like 9876543210 or +91 98765 43210 · CTC as 12, “12 LPA” or 1200000 · notice as 30, “2 months” or “Immediate” · skills separated by commas.</li>
        <li><b>Requirement Code</b> column (e.g. R-1001) puts that row into that job. Blank = the requirement chosen here, or auto-match.</li>
        <li>Same email or phone as an existing candidate = profile updated, not duplicated.</li>
      </ul>
      <div className="row"><a className="btn o sm" href="/samples/HRMS_Candidate_Template.xlsx" download>Excel template</a><a className="btn o sm" href="/samples/HRMS_Candidate_Template.csv" download>CSV template</a></div>
    </details>
  );
}
