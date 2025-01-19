// ==UserScript==
// @name         Image Translator
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Automatically translate  images on websites
// @author       You
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @downloadURL https://raw.githubusercontent.com/BrandonH1212/BB-translating-test/main/image-translator.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        minWidth: 600,
        minHeight: 800,
        serverUrl: 'http://192.168.4.20:5000/translate',
        maxConcurrent: 3, // Maximum number of concurrent translations
        checkInterval: 1000 // How often to check for new images (ms)
    };

  function gmXhrRequest(options) {
          if (typeof GM_xmlhttpRequest !== 'undefined') {
              return GM_xmlhttpRequest(options);
          }
          else if (typeof GM !== 'undefined' && GM.xmlHttpRequest) {
              return GM.xmlHttpRequest(options);
          }
          else {
              throw new Error('Neither GM_xmlhttpRequest nor GM.xmlHttpRequest are available');
          }
      }

    // Queue for processing images
    const queue = new Set();
    let processing = new Set();

    function shouldProcessImage(img) {
        // Check if image is in viewport or close to it
        const rect = img.getBoundingClientRect();
        const buffer = 1000; // Check 1000px above and below viewport

        return img.naturalWidth >= CONFIG.minWidth &&
               img.naturalHeight >= CONFIG.minHeight &&
               !img.hasAttribute('data-translated') &&
               rect.bottom >= -buffer &&
               rect.top <= window.innerHeight + buffer &&
               // Check for lazy loading
               (img.src.startsWith('http') || img.src.startsWith('data:'));
    }



  function createOverlay(img) {
      const container = document.createElement('div');
      container.style.position = 'relative';
      container.style.display = 'inline-block';

      // Create the text element
      const text = document.createElement('div');
      text.style.position = 'absolute';
      text.style.top = '5px';
      text.style.left = '5px';
      text.style.color = 'white';
      text.style.background = 'rgba(0, 0, 0, 0.5)';
      text.style.padding = '2px 5px';
      text.style.borderRadius = '3px';
      text.style.fontSize = '12px';
      text.style.fontFamily = 'Arial, sans-serif';
      text.style.zIndex = '10000';
      text.textContent = 'Processing';

      // Create the dimming and outline overlay
      const overlay = document.createElement('div');
      overlay.className = 'translation-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0, 0, 0, 0.01)';
      overlay.style.border = '2px solid #00ff00';
      overlay.style.boxSizing = 'border-box';
      overlay.style.zIndex = '9999';

      img.parentNode.insertBefore(container, img);
      container.appendChild(img);
      container.appendChild(overlay);
      container.appendChild(text);

      return { container, overlay, text };
  }

  function createCompletedMarker(img) {
      const text = document.createElement('div');
      text.style.position = 'absolute';
      text.style.top = '5px';
      text.style.left = '5px';
      text.style.color = 'white';
      text.style.background = 'rgba(0, 0, 0, 0.5)';
      text.style.padding = '2px 5px';
      text.style.borderRadius = '3px';
      text.style.fontSize = '12px';
      text.style.fontFamily = 'Arial, sans-serif';
      text.style.zIndex = '10000';
      text.textContent = 'TR';

      const container = document.createElement('div');
      container.style.position = 'relative';
      container.style.display = 'inline-block';

      img.parentNode.insertBefore(container, img);
      container.appendChild(img);
      container.appendChild(text);

      return container;
  }

  async function translateImage(img) {
      let overlayElements;
      try {
          img.setAttribute('data-translated', 'processing');
          processing.add(img);

          // Add processing overlay
          overlayElements = createOverlay(img);

          const response = await fetch(img.src);
          const blob = await response.blob();

          const formData = new FormData();
          formData.append('image', blob, 'image.jpg');

          const result = await new Promise((resolve, reject) => {
              gmXhrRequest({
                  method: 'POST',
                  url: CONFIG.serverUrl,
                  data: formData,
                  responseType: 'blob',
                  headers: {
                      'Accept': 'image/png,image/*'
                  },
                  onload: function(response) {
                      if (response.status === 200) {
                          // Create blob from response
                          const blob = new Blob([response.response], { type: 'image/png' });
                          resolve(blob);
                      } else {
                          reject(new Error(`Server returned ${response.status}`));
                      }
                  },
                  onerror: reject
              });
          });

          // Create URL from blob
          const translatedImageUrl = URL.createObjectURL(result);

          // Create a new image to verify the blob is valid
          const tempImg = new Image();
          await new Promise((resolve, reject) => {
              tempImg.onload = resolve;
              tempImg.onerror = reject;
              tempImg.src = translatedImageUrl;
          });

          // If we get here, the image is valid
          img.src = translatedImageUrl;
          img.setAttribute('data-translated', 'completed');

          // Clean up the URL after a short delay to ensure the image has loaded
          setTimeout(() => {
              URL.revokeObjectURL(translatedImageUrl);
          }, 1000);

          // Remove processing overlay and add completed marker
          if (overlayElements.container) {
              overlayElements.container.parentNode.insertBefore(img, overlayElements.container);
              overlayElements.container.remove();
              createCompletedMarker(img);
          }

      } catch (error) {
          console.error('Translation error:', error);
          img.setAttribute('data-translated', 'skipped');

          // Remove overlay on error
          if (overlayElements?.container) {
              overlayElements.container.parentNode.insertBefore(img, overlayElements.container);
              overlayElements.container.remove();
          }
      } finally {
          processing.delete(img);
          processQueue();
      }
  }

    async function processQueue() {
        // Process as many images as we can up to maxConcurrent
        while (processing.size < CONFIG.maxConcurrent && queue.size > 0) {
            const img = queue.values().next().value;
            queue.delete(img);
            translateImage(img);
        }
    }

    function addToQueue(img) {
        if (!queue.has(img) && !processing.has(img)) {
            queue.add(img);
            processQueue();
        }
    }

    function checkImages() {
        const images = document.getElementsByTagName('img');
        for (const img of images) {
            if (shouldProcessImage(img)) {
                addToQueue(img);
            }
        }
    }

    // Create Intersection Observer for lazy loaded images
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (shouldProcessImage(img)) {
                    addToQueue(img);
                }
            }
        });
    }, {
        rootMargin: '1000px' // Match the buffer in shouldProcessImage
    });

    // Observe DOM changes for new images
    const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'IMG') {
                    if (shouldProcessImage(node)) {
                        addToQueue(node);
                    }
                    imageObserver.observe(node);
                }

                // Check for images inside added nodes
                if (node.getElementsByTagName) {
                    const images = node.getElementsByTagName('img');
                    for (const img of images) {
                        if (shouldProcessImage(img)) {
                            addToQueue(img);
                        }
                        imageObserver.observe(img);
                    }
                }
            });
        });
    });

    // Initialize observers and periodic checks
    function initialize() {
        // Observe existing images
        const images = document.getElementsByTagName('img');
        for (const img of images) {
            imageObserver.observe(img);
            if (shouldProcessImage(img)) {
                addToQueue(img);
            }
        }

        // Start observing DOM changes
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Periodically check for new images (catches lazy loaded images)
        setInterval(checkImages, CONFIG.checkInterval);

        // Handle scroll events
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(checkImages, 200);
        }, { passive: true });
    }

    // Wait for document to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Add keyboard shortcut
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
            const selectedImg = document.querySelector('img:hover');
            if (selectedImg && !selectedImg.hasAttribute('data-translated')) {
                addToQueue(selectedImg);
            }
        }
    });

})();
