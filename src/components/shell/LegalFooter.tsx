/**
 * Required attribution. LEGO's Fair Play guidelines specify this wording, and
 * the LDraw parts library is CC BY 2.0, which requires crediting it. Present on
 * every route, which is why it lives in the root layout.
 */
export function LegalFooter({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="readout text-faint leading-relaxed">
        LEGO&reg; is a trademark of the LEGO Group of companies which does not
        sponsor, authorize or endorse this site. Parts library by{" "}
        <a
          className="underline decoration-edge-bright underline-offset-2 hover:text-muted"
          href="https://www.ldraw.org/"
          rel="noreferrer noopener"
          target="_blank"
        >
          LDraw.org
        </a>{" "}
        under CC BY 2.0.
      </p>
    );
  }

  return (
    <footer className="border-edge border-t bg-ground-deep px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p className="max-w-3xl text-muted text-sm leading-relaxed">
          LEGO&reg; is a trademark of the LEGO Group of companies which does not
          sponsor, authorize or endorse this site. This is an unofficial,
          non-commercial project with no affiliation to the LEGO Group.
        </p>
        <p className="max-w-3xl text-muted text-sm leading-relaxed">
          LDraw&trade; is a trademark owned and licensed by the Estate of James
          Jessiman. Part geometry and colour definitions come from the LDraw
          Parts Library, used under{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://creativecommons.org/licenses/by/2.0/"
            rel="noreferrer noopener"
            target="_blank"
          >
            CC BY 2.0
          </a>
          .
        </p>
        <div className="readout mt-2 flex flex-wrap gap-x-6 gap-y-2 text-faint">
          <a
            className="hover:text-ink"
            href="https://www.ldraw.org/"
            rel="noreferrer noopener"
            target="_blank"
          >
            ldraw.org
          </a>
          <a
            className="hover:text-ink"
            href="https://www.ldraw.org/docs-main/licenses/legal-info.html"
            rel="noreferrer noopener"
            target="_blank"
          >
            LDraw legal info
          </a>
          <a
            className="hover:text-ink"
            href="https://www.lego.com/en-us/legal/notices-and-policies/fair-play/"
            rel="noreferrer noopener"
            target="_blank"
          >
            LEGO Fair Play
          </a>
        </div>
      </div>
    </footer>
  );
}
