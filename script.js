(function () {
    // This file only handles the two things that genuinely need JavaScript:
    // downloading a PDF and downloading a Word (.docx) file. Radio button
    // selection, date/time pickers, and the Reset button are all native
    // HTML/CSS and keep working even if this script fails to load.

    function esc(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ---------- Text fields that wrap onto a new line ----------
    // Every text field is a <textarea> that grows as you type, so long text
    // drops to the next line instead of running off in one straight line.
    var textFields = Array.prototype.slice.call(document.querySelectorAll('#printable textarea'));

    function autoGrow(t) {
        if (!t.scrollHeight) return;               // field not visible right now
        t.style.height = 'auto';
        t.style.height = (t.scrollHeight + (t.offsetHeight - t.clientHeight)) + 'px';
    }
    function growAll() { textFields.forEach(autoGrow); }

    textFields.forEach(function (t) {
        t.addEventListener('input', function () { autoGrow(t); });
        if (t.classList.contains('info-input')) {
            // one-line style fields: wrap automatically, but no manual Enter line breaks
            t.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') e.preventDefault();
            });
        }
    });
    window.addEventListener('resize', growAll);
    window.addEventListener('load', growAll);
    growAll();
    document.getElementById('printable').addEventListener('reset', function () {
        setTimeout(function () {
            textFields.forEach(function (t) { t.style.height = ''; });
            growAll();
        }, 0);
    });

    // ---------- PDF: draw text fields as plain wrapped text ----------
    // html2canvas draws <textarea> content on ONE line and can overflow the page.
    // So, only inside the PDF capture, each textarea is swapped for a normal
    // <div> that wraps its text. Styles/values are read from the live form first.
    function snapshotTextFields(root) {
        var snap = {};
        var keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color',
                    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                    'borderTop', 'borderRight', 'borderBottom', 'borderLeft'];
        Array.prototype.forEach.call(root.querySelectorAll('textarea'), function (t, i) {
            var cs = window.getComputedStyle(t);
            var css = {};
            keys.forEach(function (k) { css[k] = cs[k]; });
            t.setAttribute('data-pdf-i', i);
            snap[i] = { value: t.value, height: t.offsetHeight, css: css };
        });
        return snap;
    }

    function swapTextFieldsForPdf(doc, snap) {
        Array.prototype.forEach.call(doc.querySelectorAll('textarea[data-pdf-i]'), function (t) {
            var s = snap[t.getAttribute('data-pdf-i')];
            if (!s) return;
            var d = doc.createElement('div');
            d.textContent = s.value;
            var st = d.style;
            Object.keys(s.css).forEach(function (k) { st[k] = s.css[k]; });
            st.display = 'block';
            st.boxSizing = 'border-box';
            st.width = '100%';
            st.maxWidth = '100%';
            st.height = 'auto';
            st.minHeight = s.height + 'px';
            st.margin = '0';
            st.background = 'transparent';
            st.whiteSpace = 'pre-wrap';
            st.overflowWrap = 'anywhere';
            st.wordBreak = 'break-word';
            st.overflow = 'visible';
            t.parentNode.replaceChild(d, t);
        });
    }

    // ---------- Read a native date/time input into a friendly display string ----------
    function readValue(input) {
        if (!input) return '______________________';
        if (!input.value) return '______________________';

        if (input.type === 'date') {
            var d = new Date(input.value + 'T00:00:00');
            if (isNaN(d)) return input.value;
            return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
        }

        if (input.type === 'time') {
            var parts = input.value.split(':');
            var hour = parseInt(parts[0], 10);
            var minute = parts[1];
            var ampm = hour >= 12 ? 'PM' : 'AM';
            var hour12 = hour % 12 === 0 ? 12 : hour % 12;
            return hour12 + ':' + minute + ' ' + ampm;
        }

        return input.value.trim();
    }

    function fieldRowHtml(fieldEl) {
        var labelEl = fieldEl.querySelector('.info-label');
        var label = labelEl ? labelEl.textContent.trim() : '';
        var input = fieldEl.querySelector('input, textarea');
        return '<tr>' +
            '<td style="padding:3pt 6pt;font-weight:bold;width:35%;font-size:9pt;color:#555555;">' + esc(label) + '</td>' +
            '<td style="padding:3pt 6pt;border-bottom:1px solid #333333;">' + esc(readValue(input)) + '</td>' +
            '</tr>';
    }

    // ================= PDF EXPORT =================
    // Captures the live #printable form directly — no cloning, no off-screen
    // positioning (which can make html2canvas return a blank capture).
    document.getElementById('downloadPdfBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Preparing PDF…';

        var el = document.getElementById('printable');
        var textSnap = snapshotTextFields(el);

        var opt = {
            margin: 0.4,
            filename: 'Excavation-Trenching-Safety-Inspection.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                windowWidth: el.scrollWidth,
                // Compensate for any horizontal/vertical scroll of the page the
                // form is embedded in — without this, the captured image can be
                // shifted/cropped on the left on some desktop browsers even
                // though it looks fine on mobile.
                scrollX: -window.scrollX,
                scrollY: -window.scrollY,
                // draw text fields as wrapped text (see swapTextFieldsForPdf)
                onclone: function (doc) { swapTextFieldsForPdf(doc, textSnap); }
            },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        html2pdf().set(opt).from(el).save().then(function () {
            btn.disabled = false;
            btn.textContent = '⬇ Download PDF';
        }).catch(function (err) {
            console.error(err);
            btn.disabled = false;
            btn.textContent = '⬇ Download PDF';
            alert('PDF generation failed: ' + err.message);
        });
    });

    // ================= WORD (.docx) EXPORT =================
    // Builds a small, self-contained table/paragraph HTML document (no
    // grid/flexbox, no external stylesheet, every piece of text escaped)
    // so the html-docx-js converter can parse it reliably.
    function buildWordHtml() {
        var root = document.getElementById('printable');
        var parts = [];

        Array.prototype.forEach.call(root.children, function (el) {
            if (el.classList.contains('header')) {
                var h1 = el.querySelector('h1');
                parts.push('<h1 style="color:#FF6B35;font-size:20pt;text-transform:uppercase;margin-bottom:8pt;">' + esc(h1 ? h1.textContent.trim() : '') + '</h1>');
                parts.push('<table style="width:100%;border-collapse:collapse;margin-bottom:10pt;">');
                el.querySelectorAll('.info-field').forEach(function (f) { parts.push(fieldRowHtml(f)); });
                parts.push('</table>');

            } else if (el.classList.contains('info-box') || el.classList.contains('alert-box')) {
                parts.push('<p style="background:#EFEFEF;padding:6pt;border-left:4pt solid #999999;font-size:9pt;margin-bottom:8pt;">' + esc(el.textContent.replace(/\s+/g, ' ').trim()) + '</p>');

            } else if (el.classList.contains('status-summary')) {
                var checked = el.querySelector('input[name="overall-status"]:checked');
                parts.push('<p style="font-weight:bold;font-size:12pt;margin-bottom:8pt;">Overall Status: ' + esc(checked ? checked.value : '(not selected)') + '</p>');

            } else if (el.tagName === 'H2') {
                parts.push('<h2 style="background:#1E3A5F;color:#FFFFFF;padding:6pt 8pt;font-size:13pt;margin-top:14pt;margin-bottom:6pt;">' + esc(el.textContent.trim()) + '</h2>');

            } else if (el.classList.contains('checklist-section')) {
                parts.push('<table style="width:100%;border-collapse:collapse;margin-bottom:8pt;">');
                el.querySelectorAll('.checklist-item').forEach(function (item) {
                    var radio = item.querySelector('.checkbox-container input[type="radio"]:checked');
                    var chosenLabel = radio ? radio.value : '-';
                    var textEl = item.querySelector('.item-text');
                    var text = textEl ? textEl.textContent.trim() : '';
                    parts.push('<tr>' +
                        '<td style="padding:4pt;width:18%;font-weight:bold;text-align:center;border-bottom:1px solid #EEEEEE;">' + esc(chosenLabel) + '</td>' +
                        '<td style="padding:4pt;border-bottom:1px solid #EEEEEE;">' + esc(text) + '</td>' +
                        '</tr>');
                });
                parts.push('</table>');

            } else if (el.classList.contains('atmospheric-grid')) {
                parts.push('<table style="width:100%;border-collapse:collapse;margin-bottom:10pt;">');
                el.querySelectorAll('.info-field').forEach(function (f) { parts.push(fieldRowHtml(f)); });
                parts.push('</table>');

            } else if (el.classList.contains('notes-section')) {
                var h3 = el.querySelector('h3');
                var ta = el.querySelector('textarea');
                parts.push('<h3 style="font-size:11pt;margin-top:10pt;margin-bottom:4pt;">' + esc(h3 ? h3.textContent.trim() : '') + '</h3>');
                parts.push('<p style="border:1px solid #999999;padding:6pt;min-height:50pt;">' + esc(ta && ta.value.trim() !== '' ? ta.value : ' ') + '</p>');

            } else if (el.classList.contains('signature-section')) {
                parts.push('<table style="width:100%;border-collapse:collapse;margin-top:14pt;"><tr>');
                el.querySelectorAll('.signature-box').forEach(function (box) {
                    var labelEl = box.querySelector('.signature-label');
                    parts.push('<td style="width:50%;vertical-align:top;padding:8pt;border:1px dashed #999999;">');
                    parts.push('<p style="font-weight:bold;margin-bottom:16pt;">' + esc(labelEl ? labelEl.textContent.trim() : '') + '</p>');
                    var sigEl = box.querySelector('.signature-input');
                    parts.push('<p style="font-size:11pt;border-bottom:1px solid #333333;margin:0 0 8pt 0;">' + (sigEl && sigEl.value.trim() !== '' ? esc(sigEl.value) : '&nbsp;') + '</p>');
                    box.querySelectorAll('.info-field').forEach(function (f) {
                        var lab = f.querySelector('.info-label');
                        var labelText = lab ? lab.textContent.trim() : '';
                        var dtRow = f.querySelector('.date-time-row');
                        var valText;
                        if (dtRow) {
                            var vals = [];
                            dtRow.querySelectorAll('input').forEach(function (i) {
                                var v = readValue(i);
                                if (v !== '______________________') vals.push(v);
                            });
                            valText = vals.length ? vals.join('  ') : '______________________';
                        } else {
                            valText = readValue(f.querySelector('input, textarea'));
                        }
                        parts.push('<p style="font-size:9pt;margin:2pt 0;"><b>' + esc(labelText) + '</b> ' + esc(valText) + '</p>');
                    });
                    parts.push('</td>');
                });
                parts.push('</tr></table>');

            } else if (el.classList.contains('footer')) {
                parts.push('<p style="font-size:7pt;color:#777777;margin-top:14pt;border-top:1px solid #999999;padding-top:6pt;">' + esc(el.textContent.replace(/\s+/g, ' ').trim()) + '</p>');
            }
        });

        return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<title>' + esc('Excavation & Trenching Safety Inspection') + '</title></head>' +
            '<body style="font-family:Calibri,Arial,sans-serif;font-size:10.5pt;color:#343A40;">' +
            parts.join('') +
            '</body></html>';
    }

    document.getElementById('downloadWordBtn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        var originalLabel = btn.textContent;
        btn.textContent = 'Preparing Word file…';

        try {
            if (!window.htmlDocx) {
                throw new Error('html-docx-js library did not load (check your internet connection).');
            }

            var fullHtml = buildWordHtml();
            var docxBlob = window.htmlDocx.asBlob(fullHtml);

            if (!docxBlob || docxBlob.size === 0) {
                throw new Error('Generated file was empty.');
            }

            var link = document.createElement('a');
            link.href = URL.createObjectURL(docxBlob);
            link.download = 'Excavation-Trenching-Safety-Inspection.docx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err) {
            console.error(err);
            alert('Word file generation failed: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });
})();
