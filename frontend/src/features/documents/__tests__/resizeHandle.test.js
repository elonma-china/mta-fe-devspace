// src/features/documents/__tests__/resizeHandle.test.js
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import ResizeHandle from "features/documents/components/viewer/ResizeHandle";

// Story 60: ResizeHandle now COMMITS the width on release (not on every
// mousemove) and renders a full-window shield + ghost line while dragging, so
// the PDF <iframe> can't swallow the drag's mouse events (the cause of the
// stutter + "stuck drag"). These tests lock that behaviour.

const rect1000 = () => ({ left: 0, width: 1000 });

test("resizeHandle_commitsRatioOnReleaseNotDuringMove", () => {
  const onResize = jest.fn();
  render(<ResizeHandle onResize={onResize} getContainerRect={rect1000} />);
  const handle = screen.getByRole("separator", { name: /co duỗi/i });

  fireEvent.mouseDown(handle);
  // Moving the pointer does NOT commit — the width applies only on release.
  fireEvent.mouseMove(window, { clientX: 500 });
  expect(onResize).not.toHaveBeenCalled();

  // Release commits the LAST pointer position once (50% → 0.5).
  fireEvent.mouseUp(window);
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(onResize).toHaveBeenLastCalledWith(0.5);

  // After release, further moves are ignored (drag fully ended).
  onResize.mockClear();
  fireEvent.mouseMove(window, { clientX: 700 });
  expect(onResize).not.toHaveBeenCalled();
});

test("resizeHandle_showsShieldOverlayWhileDragging", () => {
  const onResize = jest.fn();
  render(<ResizeHandle onResize={onResize} getContainerRect={rect1000} />);
  const handle = screen.getByRole("separator", { name: /co duỗi/i });

  // No shield until a drag starts.
  expect(document.querySelector(".dv-resize-overlay")).toBeNull();

  fireEvent.mouseDown(handle);
  // Shield (over the iframe) + ghost line appear while dragging.
  expect(document.querySelector(".dv-resize-overlay")).toBeTruthy();
  expect(document.querySelector(".dv-resize-ghost")).toBeTruthy();

  fireEvent.mouseUp(window);
  // Shield is gone once the drag ends.
  expect(document.querySelector(".dv-resize-overlay")).toBeNull();
});

test("resizeHandle_endsDragOnWindowBlur_noStuckDrag", () => {
  const onResize = jest.fn();
  render(<ResizeHandle onResize={onResize} getContainerRect={rect1000} />);
  const handle = screen.getByRole("separator", { name: /co duỗi/i });

  fireEvent.mouseDown(handle);
  fireEvent.mouseMove(window, { clientX: 300 });
  // Losing window focus (e.g. alt-tab / a mouseup swallowed by the iframe) must
  // END the drag — otherwise the col-resize cursor + resizing get "stuck".
  fireEvent.blur(window);
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(onResize).toHaveBeenLastCalledWith(0.3);
  expect(document.body.classList.contains("dv-resizing")).toBe(false);

  // Drag is over: subsequent moves do nothing.
  onResize.mockClear();
  fireEvent.mouseMove(window, { clientX: 800 });
  expect(onResize).not.toHaveBeenCalled();
});

test("resizeHandle_noContainerRect_doesNotCrashOrCommit", () => {
  const onResize = jest.fn();
  render(<ResizeHandle onResize={onResize} getContainerRect={() => null} />);
  const handle = screen.getByRole("separator", { name: /co duỗi/i });

  fireEvent.mouseDown(handle);
  fireEvent.mouseMove(window, { clientX: 300 });
  fireEvent.mouseUp(window);
  // No rect → no ratio captured → nothing committed, no crash.
  expect(onResize).not.toHaveBeenCalled();
});
