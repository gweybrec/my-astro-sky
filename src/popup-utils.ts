export function positionPopup(popup: HTMLElement, anchorRect: DOMRect): void {
  popup.style.position = 'fixed';
  popup.style.top = '-9999px';
  popup.style.left = '-9999px';
  popup.style.right = '';
  popup.style.bottom = '';
  document.body.appendChild(popup);

  const h = popup.offsetHeight;
  const spaceBelow = window.innerHeight - anchorRect.bottom - 4;
  const spaceAbove = anchorRect.top - 4;
  const goAbove = h > spaceBelow && spaceAbove > spaceBelow;

  popup.style.left = '';
  popup.style.right = `${window.innerWidth - anchorRect.right}px`;

  if (goAbove) {
    popup.style.top = '';
    popup.style.bottom = `${window.innerHeight - anchorRect.top + 4}px`;
  } else {
    popup.style.bottom = '';
    popup.style.top = `${anchorRect.bottom + 4}px`;
  }

  if (popup.getBoundingClientRect().left < 4) {
    popup.style.right = '';
    popup.style.left = '4px';
  }
}
