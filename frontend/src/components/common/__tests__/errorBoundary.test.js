// src/components/common/__tests__/errorBoundary.test.js
// Story 52: a render error inside the boundary must show a fallback and NOT
// unmount the rest of the tree (no white-screen-of-death). Changing resetKey
// clears the error so a fresh attempt can render.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import ErrorBoundary from "components/common/ErrorBoundary";

function Boom({ explode }) {
  if (explode) throw new Error("boom");
  return <div>child-ok</div>;
}

beforeEach(() => {
  // React logs the caught error to console.error — silence it for clean output.
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // eslint-disable-next-line no-console
  console.error.mockRestore && console.error.mockRestore();
});

test("errorBoundary_childThrows_showsFallback_siblingSurvives", () => {
  render(
    <div>
      <span data-testid="sibling">sibling</span>
      <ErrorBoundary fallback={<div data-testid="fallback">fallback</div>}>
        <Boom explode />
      </ErrorBoundary>
    </div>
  );
  // Fallback shown instead of crashing the whole tree.
  expect(screen.getByTestId("fallback")).toBeInTheDocument();
  // The sibling outside the boundary is untouched (no white screen).
  expect(screen.getByTestId("sibling")).toBeInTheDocument();
});

test("errorBoundary_noError_rendersChildren", () => {
  render(
    <ErrorBoundary fallback={<div>fallback</div>}>
      <Boom explode={false} />
    </ErrorBoundary>
  );
  expect(screen.getByText("child-ok")).toBeInTheDocument();
});

test("errorBoundary_resetKeyChange_clearsError", () => {
  const { rerender } = render(
    <ErrorBoundary resetKey="a" fallback={<div data-testid="fallback">fb</div>}>
      <Boom explode />
    </ErrorBoundary>
  );
  expect(screen.getByTestId("fallback")).toBeInTheDocument();

  // New document (resetKey changes) → boundary clears and re-renders children.
  rerender(
    <ErrorBoundary resetKey="b" fallback={<div data-testid="fallback">fb</div>}>
      <Boom explode={false} />
    </ErrorBoundary>
  );
  expect(screen.getByText("child-ok")).toBeInTheDocument();
});

test("errorBoundary_defaultFallback_whenNoneProvided", () => {
  render(
    <ErrorBoundary>
      <Boom explode />
    </ErrorBoundary>
  );
  // A default fallback renders (no crash).
  expect(screen.getByText(/đã xảy ra lỗi/i)).toBeInTheDocument();
});
