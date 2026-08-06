// src/features/analysis/components/TemplatePickerModal.test.js
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplatePickerModal from "features/analysis/components/TemplatePickerModal";

jest.mock("assets/images/report.svg", () => ({
  __esModule: true,
  ReactComponent: (props) => require("react").createElement("svg", props),
  default: "report.svg",
}));

test("test_template_picker_closed_renders_nothing", () => {
  const { container } = render(
    <TemplatePickerModal open={false} onClose={() => {}} onPick={() => {}} />
  );
  expect(container).toBeEmptyDOMElement();
});

test("test_template_picker_open_renders_two_templates", () => {
  render(<TemplatePickerModal open onClose={() => {}} onPick={() => {}} />);
  expect(screen.getByText("Tổng hợp văn bản")).toBeInTheDocument();
  expect(screen.getByText("Bài phát biểu")).toBeInTheDocument();
});

test("test_template_picker_pick_calls_onpick_then_close", () => {
  const onPick = jest.fn();
  const onClose = jest.fn();
  render(<TemplatePickerModal open onClose={onClose} onPick={onPick} />);
  fireEvent.click(screen.getByText("Tổng hợp văn bản"));
  expect(onPick).toHaveBeenCalledWith("opinion_consolidation", "Tổng hợp văn bản");
  expect(onClose).toHaveBeenCalled();
});

test("test_template_picker_shows_document_count", () => {
  render(
    <TemplatePickerModal open onClose={() => {}} onPick={() => {}} documentCount={3} />
  );
  expect(screen.getByText("3/50")).toBeInTheDocument();
});
