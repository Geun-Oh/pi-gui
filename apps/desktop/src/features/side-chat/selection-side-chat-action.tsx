import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChatIcon } from "../../ui/icons";
import { quoteFromSelection } from "./side-chat-messages";

interface SelectionAnchor {
  readonly top: number;
  readonly left: number;
  readonly quote: string;
}

const EDGE = 12;
const BUTTON_HEIGHT = 32;

/**
 * Offers "Ask in side chat" next to text selected in the thread transcript. The
 * button keeps the selection (mousedown is prevented) and hides once it collapses,
 * the transcript scrolls or the window resizes.
 */
export function SelectionSideChatAction({
  paneRef,
  disabled,
  onAsk,
}: {
  readonly paneRef: RefObject<HTMLElement | null>;
  readonly disabled: boolean;
  readonly onAsk: (quote: string) => void;
}) {
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);

  useEffect(() => {
    const evaluate = () => {
      const selection = window.getSelection();
      const transcript = paneRef.current?.querySelector('[data-testid="transcript"]');
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !transcript) {
        setAnchor(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!transcript.contains(range.commonAncestorContainer)) {
        setAnchor(null);
        return;
      }
      const quote = quoteFromSelection(selection.toString());
      const rect = range.getBoundingClientRect();
      if (!quote || (rect.width === 0 && rect.height === 0)) {
        setAnchor(null);
        return;
      }
      const below = rect.bottom + 8;
      setAnchor({
        quote,
        top:
          below + BUTTON_HEIGHT > window.innerHeight - EDGE ? rect.top - BUTTON_HEIGHT - 8 : below,
        left: Math.min(
          Math.max(rect.left + rect.width / 2, EDGE + 80),
          window.innerWidth - EDGE - 80,
        ),
      });
    };
    // The selection is final only after the pointer or key that made it is released.
    const onPointerUp = () => window.requestAnimationFrame(evaluate);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
      else if (event.key === "Shift" || event.shiftKey) evaluate();
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setAnchor(null);
    };
    const hide = () => setAnchor(null);
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [paneRef]);

  if (!anchor) return null;
  // Fixed to the viewport, outside the thread column whose children are width-constrained.
  return createPortal(
    <button
      className="selection-side-chat"
      data-testid="ask-in-side-chat"
      disabled={disabled}
      onClick={() => {
        onAsk(anchor.quote);
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
      }}
      onMouseDown={(event) => event.preventDefault()}
      style={{ top: anchor.top, left: anchor.left }}
      type="button"
    >
      <ChatIcon />
      <span>Ask in side chat</span>
    </button>,
    document.body,
  );
}
