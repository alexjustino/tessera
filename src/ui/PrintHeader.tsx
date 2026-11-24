import mark from '@/assets/mark.svg';

/**
 * The top of a printed page (ADR-066): the mark and the product's name, what the
 * document is, and when it was printed. It exists only on paper; the screen keeps
 * its own heading, and the page numbers are the stylesheet's (`print.css`).
 */
export function PrintHeader({
  title,
  subtitle,
  printedAt = new Date(),
}: {
  title: string;
  subtitle?: string | undefined;
  printedAt?: Date;
}) {
  const printed = printedAt.toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <header className="print-header hidden print:block" data-print-header>
      <div className="print-header-brand">
        <img src={mark} alt="" width={22} height={22} />
        <span>Tessera</span>
        <span className="print-header-printed">Printed {printed}</span>
      </div>
      <h1 className="print-header-title">{title}</h1>
      {subtitle !== undefined && subtitle !== '' && (
        <p className="print-header-subtitle">{subtitle}</p>
      )}
    </header>
  );
}
