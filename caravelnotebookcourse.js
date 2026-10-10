// ==UserScript==
// @name         Notebook-Course Link
// @namespace    http://tampermonkey.net/
// @version      2026-09-17
// @description  link caravel notebooks with their associated courses.
// @author       You
// @match        https://caravel.homeschoolconnections.com/course/*
// @match        https://caravel.homeschoolconnections.com/notebooks/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=homeschoolconnections.com
// @sandbox      JavaScript
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function (window) {
  'use strict';
  if (!GM_getValue('data')) {
    GM_setValue('data', '{}');
  }
  GM_registerMenuCommand('Clear all links and reload', () => {
    GM_setValue('data', '{}');
    window.location.reload();
  });
  GM_registerMenuCommand('View links', () => {
    window.alert(GM_getValue('data'));
  });

  // global helpers
  function getNotebookIdFromUrl(href) {
    const url = new URL(href);
    return url.pathname.match(/\/notebooks\/([0-9]*)/)[1];
  }

  function getCourseIdFromUrl(href) {
    const url = new URL(href);
    return url.pathname.match(/\/course\/([0-9]*)/)[1];
  }
  async function getNotebooks() {
    const res = await fetch('/notebooks');
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const notebookEls = Array.from(doc.querySelectorAll('tr a.flex'));
    const notebooks = notebookEls.map(a => {
      const name = a.querySelector('span').textContent.trim();
      const id = getNotebookIdFromUrl(a.href);
      return {
        name,
        id
      }
    });
    return notebooks;
  }
  async function getCourses() {
    const res = await fetch('/dashboard');
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const courseEls = Array.from(doc.querySelectorAll('.fi-ta-record a:has(span)'));
    const courses = courseEls.map(a => {
      const name = a.querySelector('span').textContent.trim();
      const id = getCourseIdFromUrl(a.href);
      return {
        name,
        id
      }
    });
    return courses;
  }

  // Data format:
  // { notebook: primary }
  function getAssignedNotebook(courseId) {
    const data = JSON.parse(GM_getValue('data'));
    return Object.keys(data).find(key => data[key].includes(courseId));
  }

  function getAssignedCourse(notebookId) {
    const data = JSON.parse(GM_getValue('data'));
    return data[notebookId];
  }

  function setPrimaryCourse(notebookId, courseId) {
    const data = JSON.parse(GM_getValue('data'));
    data[notebookId] = courseId;
    GM_setValue('data', JSON.stringify(data));
  }

  if (window.location.pathname.startsWith('/course')) {
    function useNav(nav) {
      const notebookTab = document.createElement('div');
      notebookTab.className = 'flex flex-row items-center justify-start p-3 text-sm font-semibold rounded-lg transition duration-150 bg-emerald-200 dark:bg-emerald-800 hover:bg-opacity-100 dark:hover:bg-opacity-100 bg-opacity-25 dark:bg-opacity-25 text-emerald-900 dark:text-emerald-100';
      const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d='M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'
            fill='none' stroke='currentColor'/>
          <path d='M8 7h7M8 11h7M8 15h5'
            fill='none' stroke='currentColor' stroke-linecap='round'/>
          <path d='M3 7h2M3 11h2M3 15h2M3 19h2'
            stroke='currentColor' stroke-linecap='round'/>
        </svg>`
      notebookTab.style.cursor = 'pointer';
      const svgCtr = document.createElement('div');
      svgCtr.className = 'mr-2 w-6 h-6 flex-shrink-0';
      const svg = new DOMParser()
        .parseFromString(svgText, 'image/svg+xml')
        .documentElement;
      svgCtr.append(svg);
      notebookTab.append(svgCtr);
      const notebookTabLabel = document.createElement('span');
      notebookTabLabel.textContent = 'Notebook';
      notebookTab.append(notebookTabLabel);

      notebookTab.onclick = () => {
        const courseId = getCourseIdFromUrl(window.location.href);
        const linkedNotebook = getAssignedNotebook(courseId);
        if (linkedNotebook) {
          window.location.href = `/notebooks/${linkedNotebook}`;
        } else {
          alert('no linked notebook');
        }
      };
      nav.querySelector('#sectionsList').prepend(notebookTab);
    }
    const nav = document.querySelector('nav[aria-label="Sections navigation"]');
    if (nav?.children?.length) {
      nav.dataset.observed = 'true';
      useNav(nav);
      console.log(nav);
    }
    const observer = new MutationObserver(() => {
      document.querySelectorAll('nav[aria-label="Sections navigation"]').forEach(nav => {
        if (nav.children.length && !nav.dataset.observed) {
          nav.dataset.observed = 'true';
          useNav(nav);
          console.log(nav);
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  } else if (window.location.pathname.startsWith('/notebooks')) {
    const _notebooks = getNotebooks();
    const _courses = getCourses();

    // Linking UI
    function useUI() {
      const notebookId = getNotebookIdFromUrl(window.location.href);
      const isLinkedCourse = getAssignedCourse(notebookId);
      const toClone = document.querySelector('div.fi-ta-content');
      toClone.dataset.observed = 'true';
      const uiSection = toClone.cloneNode();
      const container = document.createElement('div');
      container.className = 'justify-items-center text-center px-6 py-12';
      uiSection.append(container);
      if (isLinkedCourse) {
        const btn = document.createElement('button');
        btn.className =
          'fi-btn mb-4 relative grid-flow-col items-center justify-center font-medium outline-none transition duration-75 focus-visible:ring-2 rounded-lg  fi-btn-color-gray fi-color-gray fi-size-md fi-btn-size-md gap-1.5 px-4 py-2 text-sm inline-grid shadow-sm bg-white text-gray-950 hover:bg-gray-50 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 ring-1 ring-gray-950/10 dark:ring-white/20 fi-ac-action fi-ac-btn-action';
        btn.textContent = 'Go to linked course';
        btn.addEventListener('click', () => {
          window.location.href = `/course/${getAssignedCourse(notebookId)}`;
        });
        container.append(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'fi-ta-empty-state-description text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4';
        span.textContent = `This notebook has no link.`
        container.append(span);
      }
      container.append(document.createElement('br'));
      const linkButton = document.querySelector('.fi-btn').cloneNode(true);
      linkButton.removeAttribute('href');
      linkButton.removeAttribute('wire:click');
      linkButton.querySelector('span').textContent = isLinkedCourse ? 'Manage Link' : 'Create Link';
      linkButton.addEventListener('click', async () => {
        const courses = await _courses;

        function el(tag, classname = '', style = '') {
          const element = document.createElement(tag);
          element.className = classname;
          element.style = style;
          return element;
        }

        const container = el('div', 'fixed inset-0 z-40 overflow-y-auto cursor-pointer');

        function closeModal() {
          container.remove();
        }
        const modalCtr = el('div',
          'relative grid min-h-full grid-rows-[1fr_auto_1fr] justify-items-center sm:grid-rows-[1fr_auto_3fr] p-4');
        container.append(modalCtr);
        const formCtr = el('div',
          'fi-modal-window pointer-events-auto relative row-start-2 flex w-full cursor-default flex-col bg-white shadow-xl ring-1 ring-gray-950/5 dark:bg-gray-900 dark:ring-white/10 mx-auto rounded-xl max-w-4xl'
        );
        modalCtr.append(formCtr);
        const formHeader = el('div', 'fi-modal-header flex px-6 pt-6 gap-x-5');
        formCtr.append(formHeader);
        const closeXCtr = el('div', 'absolute end-4 top-4');
        const closeXBtn = el('button',
          'fi-icon-btn relative flex items-center justify-center rounded-lg outline-none transition duration-75 focus-visible:ring-2 -m-1.5 h-9 w-9 text-gray-400 hover:text-gray-500 focus-visible:ring-primary-600 dark:text-gray-500 dark:hover:text-gray-400 dark:focus-visible:ring-primary-500 fi-color-gray fi-modal-close-btn',
          '--c-300:var(--gray-300);--c-400:var(--gray-400);--c-500:var(--gray-500);--c-600:var(--gray-600);');
        closeXBtn.title = 'Close';
        closeXCtr.append(closeXBtn);
        closeXBtn.innerHTML =
          `<svg class="fi-icon-btn-icon h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"></path></svg>`
        closeXBtn.addEventListener('click', closeModal);
        const formTitleCtr = el('div');
        const formTitle = el('h2',
          'fi-modal-heading text-base font-semibold leading-6 text-gray-950 dark:text-white me-6');
        formTitle.textContent = 'Add Link to Notebook'
        formTitleCtr.append(formTitle);
        formHeader.append(closeXCtr, formTitleCtr);
        const formBodyCtr = el('div', 'fi-modal-content flex flex-col gap-y-4 py-6 px-6');
        formCtr.append(formBodyCtr);
        const formBody = el('div', 'grid grid-cols-[--cols-default] fi-fo-component-ctn gap-6');
        formBodyCtr.append(formBody);
        const formQCtrCtr = el('div', 'col-[--col-span-default]');
        formBody.append(formQCtrCtr);
        const formQCtr = el('div', 'fi-fo-field-wrp');
        formQCtrCtr.append(formQCtr);
        const formQ = el('div', 'grid gap-y-2');
        formQCtr.append(formQ);
        const formQLabelCtr = el('div', 'flex items-center gap-x-3 justify-between');
        formQ.append(formQLabelCtr);
        const formQLabel = el('label', 'fi-fo-field-wrp-label inline-flex items-center gap-x-3');
        formQLabelCtr.append(formQLabel);
        const formQSpan = el('span', 'text-sm font-medium leading-6 text-gray-950 dark:text-white');
        formQSpan.textContent = 'Choose a course to link.';
        formQLabel.append(formQSpan);
        const selectCtrCtrCtr = el('div', 'grid auto-cols-fr gap-y-2');
        formQ.append(selectCtrCtrCtr);
        const selectCtrCtr = el('div',
          'fi-input-wrp flex rounded-lg shadow-sm ring-1 transition duration-75 bg-white dark:bg-white/5 [&:not(:has(.fi-ac-action:focus))]:focus-within:ring-2 ring-gray-950/10 dark:ring-white/20 [&:not(:has(.fi-ac-action:focus))]:focus-within:ring-primary-600 dark:[&:not(:has(.fi-ac-action:focus))]:focus-within:ring-primary-500 fi-fo-select'
        );
        selectCtrCtrCtr.append(selectCtrCtr)
        const selectCtr = el('div', 'fi-input-wrp-input min-w-0 flex-1');
        selectCtrCtr.append(selectCtr);
        const select = el('select',
          'fi-select-input block w-full border-none bg-transparent py-1.5 pe-8 text-base text-gray-950 transition duration-75 focus:ring-0 disabled:text-gray-500 disabled:[-webkit-text-fill-color:theme(colors.gray.500)] dark:text-white dark:disabled:text-gray-400 dark:disabled:[-webkit-text-fill-color:theme(colors.gray.400)] sm:text-sm sm:leading-6 [&_optgroup]:bg-white [&_optgroup]:dark:bg-gray-900 [&_option]:bg-white [&_option]:dark:bg-gray-900 ps-3'
        );
        selectCtr.append(select);
        courses.forEach(course => {
          const opt = el('option');
          opt.value = course.id;
          opt.textContent = course.name;
          select.append(opt);
        });
        const formFooterCtr = el('div', 'fi-modal-footer w-full px-6 pb-6');
        formCtr.append(formFooterCtr);
        const formFooter = el('div', 'fi-modal-footer-actions gap-3 flex flex-wrap items-center');
        formFooterCtr.append(formFooter);
        const confirmLinkBtn = el('button',
          'fi-btn relative grid-flow-col items-center justify-center font-medium outline-none transition duration-75 focus-visible:ring-2 rounded-lg fi-color-custom fi-btn-color-primary fi-color-primary fi-size-md fi-btn-size-md gap-1.5 px-4 py-2 text-sm inline-grid shadow-sm bg-custom-600 text-white hover:bg-custom-500 focus-visible:ring-custom-500/50 dark:bg-custom-500 dark:hover:bg-custom-400 dark:focus-visible:ring-custom-400/50 fi-ac-action fi-ac-btn-action'
        );
        confirmLinkBtn.textContent = 'Create Link';
        confirmLinkBtn.addEventListener('click', () => {
          setPrimaryCourse(notebookId, select.value);
          closeModal();
        });
        formFooter.append(confirmLinkBtn);
        const cancelBtn = el('button',
          'fi-btn relative grid-flow-col items-center justify-center font-medium outline-none transition duration-75 focus-visible:ring-2 rounded-lg  fi-btn-color-gray fi-color-gray fi-size-md fi-btn-size-md gap-1.5 px-4 py-2 text-sm inline-grid shadow-sm bg-white text-gray-950 hover:bg-gray-50 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 ring-1 ring-gray-950/10 dark:ring-white/20 fi-ac-action fi-ac-btn-action'
        );
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', closeModal);
        formFooter.append(cancelBtn);
        document.body.append(container);
      });
      container.append(linkButton);
      toClone.parentNode.append(uiSection);
    }
    useUI();
  }
})(unsafeWindow);
