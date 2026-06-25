export function CodeView({ code, activeLine }: { code: string; activeLine: number }) {
  const lines = code.split("\n");
  return (
    <pre className="codeview">
      {lines.map((ln, i) => (
        <div key={i} className={i + 1 === activeLine ? "line active" : "line"}>
          <span className="lineno">{i + 1}</span>
          <span className="src">{ln || " "}</span>
        </div>
      ))}
    </pre>
  );
}
