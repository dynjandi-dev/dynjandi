import { checkUploadcareUrl } from "./check.js";
import { renderResult } from "./render.js";

const form = document.querySelector<HTMLFormElement>("#check-form");
const input = document.querySelector<HTMLInputElement>("#url");
const section = document.querySelector<HTMLElement>("#result");

if (form === null || input === null || section === null) {
  throw new Error("index.html is missing #check-form, #url or #result");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderResult(section, checkUploadcareUrl(input.value));
});
