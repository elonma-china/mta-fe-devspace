// src/components/common/inputs/__tests__/searchBar.test.js
//
// Story 116 #2: SearchBar gains an optional `showMenuIcon` prop that renders a
// 3-line (hamburger) glyph inside the box. It is display-only and OPT-IN
// (default off) so every other consumer — and the SearchBar nested inside every
// MultiSelectDropdown — is unaffected.
import React from "react";
import { render, screen } from "@testing-library/react";

import SearchBar from "../SearchBar";

jest.mock("assets/images/search.svg", () => ({
  ReactComponent: () => <span data-testid="mag-icon" />,
}));
jest.mock("assets/images/three-line.svg", () => ({
  ReactComponent: () => <span data-testid="menu-glyph" />,
}));

test("searchBar_showMenuIcon_rendersMenuIcon", () => {
  const { container } = render(
    <SearchBar value="" onChange={() => {}} placeholder="Tìm" showMenuIcon />
  );
  expect(container.querySelector(".searchbar__menu-icon")).not.toBeNull();
  expect(screen.getByTestId("menu-glyph")).toBeInTheDocument();
});

test("searchBar_default_noMenuIcon", () => {
  // Regression: default (no prop) → no menu icon, so shared/nested consumers
  // (admin toolbars, MultiSelectDropdown filters) look exactly as before.
  const { container } = render(
    <SearchBar value="" onChange={() => {}} placeholder="Tìm" />
  );
  expect(container.querySelector(".searchbar__menu-icon")).toBeNull();
  expect(screen.queryByTestId("menu-glyph")).toBeNull();
  // The magnifier icon is unchanged.
  expect(screen.getByTestId("mag-icon")).toBeInTheDocument();
});
