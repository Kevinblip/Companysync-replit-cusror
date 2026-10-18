import { getPublicPageMeta } from '../../lib/publicPageMeta.js';

function setMeta(attr, key, content) {
  let tag = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function readMeta(attr, key) {
  return document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content') || '';
}

export function applyPageMeta(pathname) {
  const meta = getPublicPageMeta(pathname, window.location.origin);
  if (!meta) return () => {};
  const previous = {
    title: document.title,
    description: readMeta('name', 'description'),
    ogTitle: readMeta('property', 'og:title'),
    ogDescription: readMeta('property', 'og:description'),
    ogImage: readMeta('property', 'og:image'),
    ogUrl: readMeta('property', 'og:url'),
  };
  document.title = meta.title;
  setMeta('name', 'description', meta.description);
  setMeta('property', 'og:title', meta.title);
  setMeta('property', 'og:description', meta.description);
  setMeta('property', 'og:image', meta.image);
  setMeta('property', 'og:url', meta.url);
  return () => {
    document.title = previous.title;
    setMeta('name', 'description', previous.description);
    setMeta('property', 'og:title', previous.ogTitle);
    setMeta('property', 'og:description', previous.ogDescription);
    if (previous.ogImage) setMeta('property', 'og:image', previous.ogImage);
    setMeta('property', 'og:url', previous.ogUrl);
  };
}
