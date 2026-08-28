/**
 * Required attribution. LEGO's Fair Play guidelines specify the trademark
 * wording, and the LDraw Parts Library is CC BY, which specifies the rest.
 *
 * CAreadme.txt in the library asks for five things: name the creator, link the
 * work, name the licence, link the licence, and say whether it was modified.
 * The first four are here; the fifth is here too, because a packed model inlines
 * the part files it uses, which LDraw's own rule on derivative works counts as a
 * modification of the library rather than a mere reference to it.
 *
 * Both licence versions are named because both ship. Parts touched since
 * 2023-03-05 carry CC BY 4.0, older ones CC BY 2.0 or both, and the OMR models
 * carry CCAL 2.0, which CAreadme.txt defines as a deprecated spelling of CC BY
 * 2.0. Naming only one of them would credit the wrong licence for most of the
 * geometry on screen.
 *
 * Each route renders this itself: the gallery and the two stages, full on the
 * gallery and compact over a canvas. It is not in the root layout, so a new
 * route has to opt in.
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
        under{" "}
        <a
          className="underline decoration-edge-bright underline-offset-2 hover:text-muted"
          href="https://creativecommons.org/licenses/by/2.0/"
          rel="noreferrer noopener"
          target="_blank"
        >
          CC BY 2.0
        </a>{" "}
        and{" "}
        <a
          className="underline decoration-edge-bright underline-offset-2 hover:text-muted"
          href="https://creativecommons.org/licenses/by/4.0/"
          rel="noreferrer noopener"
          target="_blank"
        >
          CC BY 4.0
        </a>
        , repacked.
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
          Jessiman. Part geometry and colour definitions come from the{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://library.ldraw.org/"
            rel="noreferrer noopener"
            target="_blank"
          >
            LDraw Parts Library
          </a>
          , used under{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://creativecommons.org/licenses/by/2.0/"
            rel="noreferrer noopener"
            target="_blank"
          >
            CC BY 2.0
          </a>{" "}
          and{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://creativecommons.org/licenses/by/4.0/"
            rel="noreferrer noopener"
            target="_blank"
          >
            CC BY 4.0
          </a>
          , depending on the part.
        </p>
        <p className="max-w-3xl text-muted text-sm leading-relaxed">
          Modified: every model here is repacked into one file, with the part
          files it references inlined and their names normalised. No geometry is
          altered. Official sets come from the{" "}
          <a
            className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-accent-fg"
            href="https://library.ldraw.org/omr/sets"
            rel="noreferrer noopener"
            target="_blank"
          >
            Official Model Repository
          </a>{" "}
          and are credited to the author who built them.
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
          {/* Last, and pushed to the far end: the three above it are conditions
              of using the library, this one is just who built the thing. */}
          <a
            className="ml-auto hover:text-ink"
            href="https://thebuilder.dk"
            rel="noreferrer noopener"
            target="_blank"
          >
            Made by thebuilder
          </a>
        </div>
      </div>
    </footer>
  );
}
