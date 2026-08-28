"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loadOmrIndex, type OmrSet, searchSets } from "@/lib/omrIndex";

interface SetComboboxProps {
  disabled: boolean;
  /** Sized for the front page's headline field rather than a card's. */
  large?: boolean;
  onChange: (value: string) => void;
  /** Chosen from the list, rather than typed. Submits straight away. */
  onPick: (setId: string) => void;
  value: string;
}

/** Where in the list the keyboard is, with -1 meaning "still in the field". */
const NONE = -1;

const themeLabel = (set: OmrSet) =>
  [set.theme, set.year].filter(Boolean).join(" · ");

/**
 * A set number field that can also be searched by name.
 *
 * The OMR's 1,470 sets are only findable by number otherwise, which is fine if
 * you have the box in front of you and useless if you half-remember a name. The
 * index is fetched on first interaction, and a full set number still works
 * whether or not it is in the list, so nothing depends on the suggestions.
 */
export function SetCombobox({
  disabled,
  large = false,
  onChange,
  onPick,
  value,
}: SetComboboxProps) {
  const listId = useId();
  const optionId = useId();
  const [sets, setSets] = useState<OmrSet[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(NONE);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (blurTimer.current !== null) {
        clearTimeout(blurTimer.current);
      }
    },
    []
  );

  const matches = open ? searchSets(sets, value) : [];
  const activeSet = matches[active];

  /** Pull the index in on first contact, not with the page. */
  const warm = () => {
    if (sets.length === 0) {
      loadOmrIndex().then(setSets);
    }
  };

  const choose = (set: OmrSet) => {
    setOpen(false);
    setActive(NONE);
    onChange(set.setId);
    onPick(set.setId);
  };

  const move = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    // Wraps through -1, so arrowing off either end returns you to the field.
    const next = active + delta;
    setActive(next < NONE ? matches.length - 1 : next % matches.length);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActive(NONE);
      return;
    }
    // Enter on a highlighted row picks it; otherwise the form submits whatever
    // was typed, which is how a set number not in the index still opens.
    if (event.key === "Enter" && activeSet) {
      event.preventDefault();
      choose(activeSet);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        aria-activedescendant={activeSet ? `${optionId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={open && matches.length > 0 ? listId : undefined}
        aria-expanded={open && matches.length > 0}
        aria-label="LEGO set number or name"
        autoComplete="off"
        // 1rem keeps iOS from zooming the page on focus. The readout size is
        // fine once there is room for the zoom not to matter.
        className={`readout w-full border border-edge text-base text-ink placeholder:text-faint ${
          large
            ? "bg-panel px-3 py-2.5 sm:text-sm"
            : "bg-panel-raised px-2 py-1.5 sm:text-[11px]"
        }`}
        disabled={disabled}
        onBlur={() => {
          // Outlast the click that may be landing on an option.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(NONE);
        }}
        onFocus={() => {
          warm();
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="10220, or millennium falcon"
        role="combobox"
        value={value}
      />

      {matches.length > 0 && (
        <div
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto border border-edge bg-panel-raised shadow-lg"
          id={listId}
          role="listbox"
        >
          {matches.map((set, index) => (
            <SetOption
              active={index === active}
              id={`${optionId}-${index}`}
              key={set.setId}
              onHover={() => setActive(index)}
              onPick={() => choose(set)}
              set={set}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SetOptionProps {
  active: boolean;
  id: string;
  onHover: () => void;
  onPick: () => void;
  set: OmrSet;
}

function SetOption({ active, id, onHover, onPick, set }: SetOptionProps) {
  return (
    // Focus stays in the field and aria-activedescendant points here, which is
    // what lets you arrow through the list while still typing. tabIndex={-1}
    // keeps the option out of the tab order while leaving it focusable.
    <div
      aria-selected={active}
      className={`cursor-pointer px-2 py-1.5 ${active ? "bg-accent/15" : ""}`}
      id={id}
      // mousedown, not click: the input's blur would close the list first.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      onMouseEnter={onHover}
      role="option"
      tabIndex={-1}
    >
      <span className="readout text-ink">{set.setId}</span>
      <span className="ml-2 text-ink text-sm">{set.name}</span>
      <span className="readout mt-0.5 block text-faint">{themeLabel(set)}</span>
    </div>
  );
}
