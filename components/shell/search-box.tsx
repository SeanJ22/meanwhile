"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  KIND_LABEL,
  buildSearchIndex,
  flattenGroups,
  getSearchIndex,
  groupResults,
  highlightParts,
  searchItems,
  type SearchItem,
} from "@/lib/search";
import { useShellData } from "@/lib/state/data";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "./tier-style";

/**
 * Search with autocomplete.
 *
 * Ports the keyboard contract from EdiaStratMap's `onSearchInput` /
 * `onSearchKeydown` / `updateAcSelection` / `selectAutocomplete` /
 * `closeAutocomplete`: debounced input, arrows move the cursor, Enter selects,
 * Escape closes, and blur closes on a 150ms timeout so a click on a row lands
 * before the list disappears.
 *
 * Rows are real buttons rather than divs with click handlers, so the list is
 * reachable without a mouse and announced as a list of choices.
 */

const DEBOUNCE_MS = 120;
const BLUR_CLOSE_MS = 150;

export function SearchBox({
  onPick,
}: {
  /** Fly the map to a result and open its popup. */
  onPick: (item: SearchItem) => void;
}) {
  const { venues } = useShellData();
  const ui = useUi();
  const dispatch = useUiDispatch();

  // Uncommitted text lives here; the committed query lives in the store. That
  // split is what lets the input stay responsive while the map filters on a
  // debounced value.
  const [draft, setDraft] = useState(ui.search.query);
  const debounce = useRef<number | undefined>(undefined);
  const blurTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  // Rebuilt only when the venue set actually changes — Edia's
  // getAutocompleteCache / invalidateCaches, keyed on a cheap token.
  const index = useMemo(() => {
    const token = venues.map((v) => v.key).join(",");
    return getSearchIndex(token, () => buildSearchIndex(venues));
  }, [venues]);

  const groups = useMemo(
    () => groupResults(searchItems(index, draft)),
    [index, draft],
  );
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  useEffect(() => {
    return () => {
      window.clearTimeout(debounce.current);
      window.clearTimeout(blurTimer.current);
    };
  }, []);

  function commit(value: string) {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      dispatch({ type: "search/input", query: value });
    }, DEBOUNCE_MS);
  }

  function pick(item: SearchItem) {
    window.clearTimeout(blurTimer.current);
    setDraft(item.label);
    dispatch({ type: "search/input", query: item.label });
    dispatch({ type: "search/open", open: false });
    onPick(item);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      dispatch({ type: "search/open", open: false });
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (flat.length === 0) return;
      event.preventDefault();

      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, so holding an arrow key never dead-ends at either edge.
      const next =
        (ui.search.highlighted + step + flat.length + 1) % (flat.length + 1);
      dispatch({ type: "search/highlight", index: next === flat.length ? -1 : next });
      dispatch({ type: "search/open", open: true });
      return;
    }

    if (event.key === "Enter") {
      const item = flat[ui.search.highlighted];
      if (item) {
        event.preventDefault();
        pick(item);
      }
    }
  }

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (ui.search.highlighted < 0 || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-index="${ui.search.highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [ui.search.highlighted]);

  const open = ui.search.open && flat.length > 0;
  let cursor = -1;

  return (
    <div className="search-box">
      <div className="search-wrap">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>

        <input
          className="search-input"
          type="search"
          value={draft}
          placeholder="Search meetings, bodies, districts…"
          aria-label="Search"
          aria-expanded={open}
          aria-controls="search-autocomplete"
          role="combobox"
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (draft.trim()) dispatch({ type: "search/open", open: true });
          }}
          onBlur={() => {
            // Delayed so a mousedown on a row still registers.
            blurTimer.current = window.setTimeout(
              () => dispatch({ type: "search/open", open: false }),
              BLUR_CLOSE_MS,
            );
          }}
        />

        <div
          id="search-autocomplete"
          ref={listRef}
          className={`search-autocomplete${open ? " open" : ""}`}
          role="listbox"
        >
          {groups.map((group) => (
            <div key={group.kind}>
              <div className="search-ac-group">{group.kind}</div>
              {group.items.map((item) => {
                cursor++;
                const index = cursor;
                const [before, hit, after] = highlightParts(item.label, draft);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="search-ac-item"
                    data-index={index}
                    data-selected={index === ui.search.highlighted}
                    role="option"
                    aria-selected={index === ui.search.highlighted}
                    style={tierVars(item.tier)}
                    onMouseEnter={() =>
                      dispatch({ type: "search/highlight", index })
                    }
                    onClick={() => pick(item)}
                  >
                    <span className="search-ac-type">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="search-ac-name">
                      {before}
                      <b>{hit}</b>
                      {after}
                    </span>
                    {item.meta && (
                      <span className="search-ac-meta">{item.meta}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
