// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSetCard } from "./OpenSetCard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const putUpload = vi.fn();
vi.mock("@/lib/uploadStore", () => ({
  putUpload: (m: unknown) => putUpload(m),
}));

const INDEX = { columns: [], sets: [] };

/** What /api/omr/[set] returns for a set it packed. */
const PACKED = {
  author: "Willy Tschager [Holly-Wood]",
  bricks: 368,
  missing: [],
  mpd: "0 FILE 928-1.mpd",
  partNames: { "3001.dat": "Brick  2 x  4" },
  setId: "928-1",
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Serve the index, and whatever the set route should return this time. */
function stubApi(setResponse: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url === "/omr-index.json" ? json(INDEX) : setResponse()
    )
  );
}

const OPEN_BUTTON = /open/i;
const TAKES_A_MOMENT = /only the first open is slow/i;
const NOT_IN_OMR = /not in the OMR/;
const COULD_NOT_OPEN = /could not be opened/i;
const COULD_NOT_REACH = /could not reach/i;

const field = () => screen.getByRole("combobox");
const openButton = () => screen.getByRole("button", { name: OPEN_BUTTON });

beforeEach(() => {
  push.mockClear();
  putUpload.mockClear();
  stubApi(() => json(PACKED));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submit(value: string) {
  const user = userEvent.setup();
  render(<OpenSetCard />);
  await user.type(field(), value);
  await user.click(openButton());
  return user;
}

describe("OpenSetCard", () => {
  it("asks the set route for whatever was typed", async () => {
    await submit("928");

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/omr/928"));
  });

  it("does nothing when the field is empty", async () => {
    const user = userEvent.setup();
    render(<OpenSetCard />);

    await user.click(openButton());

    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/omr"));
  });

  it("ignores surrounding whitespace", async () => {
    await submit("  928  ");

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/omr/928"));
  });

  it("escapes the set number rather than pasting it into the path", async () => {
    await submit("../secret");

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/omr/..%2Fsecret")
    );
  });

  it("hands the packed model to the store and navigates to it", async () => {
    await submit("928");

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/build/local-omr-928-1")
    );
    expect(putUpload).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "local-omr-928-1", text: PACKED.mpd })
    );
  });

  it("carries the author through as credit, as CC BY requires", async () => {
    await submit("928");

    await waitFor(() =>
      expect(putUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          credit: "Willy Tschager [Holly-Wood], LDraw OMR (CC BY 2.0)",
          title: "928-1",
        })
      )
    );
  });

  it("still credits the repository when a set names no author", async () => {
    stubApi(() => json({ ...PACKED, author: null }));

    await submit("928");

    await waitFor(() =>
      expect(putUpload).toHaveBeenCalledWith(
        expect.objectContaining({ credit: "LDraw OMR (CC BY 2.0)" })
      )
    );
  });

  it("carries the missing parts through, so the build can warn", async () => {
    stubApi(() => json({ ...PACKED, missing: ["99999.dat"] }));

    await submit("928");

    await waitFor(() =>
      expect(putUpload).toHaveBeenCalledWith(
        expect.objectContaining({ missingParts: ["99999.dat"] })
      )
    );
  });

  it("says the first open takes a moment, because it does", async () => {
    // Packing a cold set is a few hundred network lookups; a spinner with no
    // explanation reads as broken.
    stubApi(() => new Promise(() => undefined));

    await submit("928");

    expect(await screen.findByText(TAKES_A_MOMENT)).toBeInTheDocument();
  });

  it("disables the field while it works", async () => {
    stubApi(() => new Promise(() => undefined));

    await submit("928");

    await waitFor(() => expect(field()).toBeDisabled());
  });

  it("shows the reason a set could not be opened", async () => {
    stubApi(() => json({ error: "set 99999-1 is not in the OMR." }, 404));

    await submit("99999");

    expect(await screen.findByText(NOT_IN_OMR)).toBeInTheDocument();
  });

  it("does not navigate when the set could not be opened", async () => {
    stubApi(() => json({ error: "nope" }, 404));

    await submit("99999");

    await screen.findByText("nope");
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to a readable message when the route gives no reason", async () => {
    stubApi(() => json({}, 500));

    await submit("928");

    expect(await screen.findByText(COULD_NOT_OPEN)).toBeInTheDocument();
  });

  it("reports a network failure rather than hanging", async () => {
    stubApi(() => Promise.reject(new Error("offline")));

    await submit("928");

    expect(await screen.findByText(COULD_NOT_REACH)).toBeInTheDocument();
  });
});
