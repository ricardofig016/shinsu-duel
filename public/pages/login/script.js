import { loadComponent } from "/utils/component-util.js";
import { safeNextPath } from "/utils/auth-redirect.js";
import { loadSession, resolveDestination, submitLogin } from "/pages/login/login-form.js";

document.addEventListener("DOMContentLoaded", async () => {
  const navbarContainer = document.getElementById("navbar-component");
  await loadComponent(navbarContainer, "navbar");

  const search = window.location.search;

  // A visitor who is already signed in has no business on this page.
  const destination = resolveDestination({ status: await loadSession(), search });
  if (destination) {
    window.location.assign(destination);
    return;
  }

  const form = document.getElementById("login-form");
  const input = document.getElementById("login-username");
  const button = document.getElementById("login-submit-btn");
  const error = document.getElementById("login-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;

    const message = await submitLogin({ username: input.value.trim(), nextPath: safeNextPath(search) });

    // A successful login has already sent the browser to its destination.
    if (message === null) return;

    error.textContent = message;
    error.classList.remove("hidden");
    button.disabled = false;
    input.focus();
  });
});
