// Query at each keypress so expanded sections and pending buttons stay accurate.
export function focusableElements(container) {
  return [...container.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      for (let ancestor = element; ancestor && container.contains(ancestor); ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (ancestor.tagName === 'DETAILS' && !ancestor.open
          && !ancestor.querySelector(':scope > summary')?.contains(element)) return false;
      }
      return true;
    });
}

export function trapTabKey(event, container) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const elements = focusableElements(container);
  const index = elements.indexOf(document.activeElement);
  if (!elements.length) {
    event.preventDefault();
    container.focus();
  } else if (event.shiftKey && index <= 0) {
    event.preventDefault();
    elements.at(-1).focus();
  } else if (!event.shiftKey && (index === -1 || index === elements.length - 1)) {
    event.preventDefault();
    elements[0].focus();
  }
}
