(function () {
  'use strict';

  var data = window.__DEEP_SVELTEKIT__;
  if (!data) {
    document.getElementById('app').innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">!</div>' +
      '<div class="empty-state-title">No data found</div>' +
      '<div class="empty-state-desc">window.__DEEP_SVELTEKIT__ is missing.</div></div>';
    return;
  }

  var state = {
    view: 'graph',
    selectedNode: null,
    searchQuery: '',
    expandedDirs: new Set(),
    highlightedNodeId: null,
    sidebarCollapsed: false,
    searchOpen: false,
    insightSections: { circular: true, deadExports: true, orphans: true, complexity: true },
  };

  var extIcons = {
    '.js': { icon: 'JS', cls: 'js' },
    '.mjs': { icon: 'JS', cls: 'js' },
    '.cjs': { icon: 'JS', cls: 'js' },
    '.ts': { icon: 'TS', cls: 'ts' },
    '.tsx': { icon: 'TX', cls: 'tsx' },
    '.jsx': { icon: 'JX', cls: 'jsx' },
    '.svelte': { icon: 'SV', cls: 'svelte' }
  };

  var dirColorMap = {};
  var dirColorIndex = 0;
  var GOLDEN_ANGLE = 137.508;

  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; } else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    var toHex = function (x) { var hex = Math.round(x * 255).toString(16); return hex.length === 1 ? '0' + hex : hex; };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function getDirColor(key) {
    if (!dirColorMap[key]) {
      var hue = (dirColorIndex * GOLDEN_ANGLE) % 360;
      var sat = 60 + (dirColorIndex % 3) * 12;
      var lit = 58 + (dirColorIndex % 4) * 6;
      dirColorMap[key] = hslToHex(hue, sat, lit);
      dirColorIndex++;
    }
    return dirColorMap[key];
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  var fileMap = {};
  data.files.forEach(function (f) { fileMap[f.path] = f; });

  var usedByMap = {};
  if (data.graph && data.graph.edges) {
    data.graph.edges.forEach(function (e) {
      if (!usedByMap[e.target]) usedByMap[e.target] = [];
      usedByMap[e.target].push(e.source);
    });
  }

  function fileComplexity(f) {
    if (!f.functions || f.functions.length === 0) return 0;
    var total = 0;
    f.functions.forEach(function (fn) {
      var span = (fn.endLine || fn.line) - fn.line + 1;
      total += Math.min(span, 100);
    });
    return Math.round(total / f.functions.length);
  }

  var $app = document.getElementById('app');
  var $sidebar = document.getElementById('sidebar');
  var $sidebarContent = document.getElementById('sidebar-content');
  var $main = document.getElementById('main');
  var $detailPanel = document.getElementById('detail-panel');
  var $detailBody = document.getElementById('detail-body');
  var $searchInput = document.getElementById('search-input');
  var $searchResults = document.getElementById('search-results');
  var $bottomFiles = document.getElementById('bottom-files');
  var $bottomFunctions = document.getElementById('bottom-functions');
  var $bottomDeps = document.getElementById('bottom-deps');
  var $tooltip = document.getElementById('tooltip');

  if (data.stats) {
    document.getElementById('stat-files').textContent = data.stats.totalFiles || 0;
    document.getElementById('stat-functions').textContent = data.stats.totalFunctions || 0;
    document.getElementById('stat-deps').textContent = data.stats.totalDependencies || 0;
    $bottomFiles.textContent = data.stats.totalFiles || 0;
    $bottomFunctions.textContent = data.stats.totalFunctions || 0;
    $bottomDeps.textContent = data.stats.totalDependencies || 0;
  }

  var fwEl = document.getElementById('bottom-framework');
  if (fwEl && data.meta && data.meta.framework) {
    var fwName = typeof data.meta.framework === 'string' ? data.meta.framework : data.meta.framework.name;
    fwEl.textContent = fwName || 'generic';
  }

  var tabButtons = document.querySelectorAll('.view-tab');
  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchView(btn.dataset.view);
    });
  });

  function switchView(view) {
    state.view = view;
    tabButtons.forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
    renderMain();
    updateHash();
  }

  function buildFileTree() {
    var root = { name: '', children: {}, files: [] };
    data.files.forEach(function (f) {
      var parts = f.path.split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!node.children[parts[i]]) {
          node.children[parts[i]] = { name: parts[i], children: {}, files: [] };
        }
        node = node.children[parts[i]];
      }
      node.files.push(f);
    });
    return root;
  }

  function renderFileTree() {
    var tree = buildFileTree();
    $sidebarContent.innerHTML = '';
    var container = document.createElement('div');
    container.className = 'file-tree';
    renderTreeNode(container, tree, 0, '');
    $sidebarContent.appendChild(container);
  }

  function renderTreeNode(parent, node, depth, pathPrefix) {
    var dirs = Object.keys(node.children).sort();
    var files = node.files.slice().sort(function (a, b) {
      return a.path.localeCompare(b.path);
    });

    dirs.forEach(function (dirName) {
      var dirPath = pathPrefix ? pathPrefix + '/' + dirName : dirName;
      var child = node.children[dirName];
      var isExpanded = state.expandedDirs.has(dirPath);

      var ds = countDirStats(child);

      var item = document.createElement('div');
      item.className = 'tree-item directory';
      item.style.paddingLeft = (depth * 16 + 8) + 'px';
      item.innerHTML =
        '<span class="tree-chevron ' + (isExpanded ? 'open' : '') + '">\u25B6</span>' +
        '<span class="tree-icon ' + (isExpanded ? 'dir-open' : 'dir') + '">' + (isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1') + '</span>' +
        '<span class="tree-label">' + escapeHtml(dirName) + '</span>' +
        '<span class="tree-metrics">' +
          '<span class="tree-metric tm-fns" title="Functions">' + ds.fns + ' fn</span>' +
          '<span class="tree-metric tm-lines" title="Lines">' + ds.lines + '</span>' +
        '</span>' +
        '<span class="tree-badge">' + ds.files + '</span>';

      item.addEventListener('click', function () {
        if (state.expandedDirs.has(dirPath)) {
          state.expandedDirs.delete(dirPath);
        } else {
          state.expandedDirs.add(dirPath);
        }
        renderFileTree();
      });

      parent.appendChild(item);

      if (isExpanded) {
        var childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        renderTreeNode(childContainer, child, depth + 1, dirPath);
        parent.appendChild(childContainer);
      }
    });

    files.forEach(function (f) {
      var fileName = f.path.split('/').pop();
      var ext = f.extension || '';
      var iconInfo = extIcons[ext] || { icon: '\u2022', cls: '' };
      var cx = fileComplexity(f);
      var cxColor = cx < 10 ? '#3fb950' : cx < 25 ? '#d29922' : '#f85149';
      var cxWidth = Math.min(cx, 60);
      var fnCount = f.functions ? f.functions.length : 0;
      var coupling = usedByMap[f.path] ? usedByMap[f.path].length : 0;

      var item = document.createElement('div');
      item.className = 'tree-item' + (state.selectedNode === f.path ? ' active' : '');
      item.style.paddingLeft = (depth * 16 + 8) + 'px';
      item.innerHTML =
        '<span class="tree-indent"></span>' +
        '<span class="tree-icon ' + iconInfo.cls + '">' + iconInfo.icon + '</span>' +
        '<span class="tree-label">' + escapeHtml(fileName) + '</span>' +
        '<span class="tree-metrics">' +
          (fnCount > 0 ? '<span class="tree-metric tm-fns" title="' + fnCount + ' functions">' + fnCount + ' fn</span>' : '') +
          (coupling > 0 ? '<span class="tree-metric tm-coupling" title="Imported by ' + coupling + ' files">' + coupling + '\u2191</span>' : '') +
        '</span>' +
        '<span class="tree-cx-bar" title="Complexity: ' + cx + '">' +
          '<span class="tree-cx-fill" style="width:' + cxWidth + '%;background:' + cxColor + '"></span>' +
        '</span>' +
        '<span class="tree-badge">' + f.lines + '</span>';

      item.addEventListener('click', function () {
        selectFile(f.path);
      });

      parent.appendChild(item);
    });
  }

  function countFiles(node) {
    var c = node.files.length;
    Object.keys(node.children).forEach(function (k) {
      c += countFiles(node.children[k]);
    });
    return c;
  }

  function countDirStats(node) {
    var stats = { files: 0, fns: 0, lines: 0, maxCx: 0 };
    node.files.forEach(function (f) {
      stats.files++;
      stats.fns += (f.functions ? f.functions.length : 0);
      stats.lines += f.lines || 0;
      var cx = fileComplexity(f);
      if (cx > stats.maxCx) stats.maxCx = cx;
    });
    Object.keys(node.children).forEach(function (k) {
      var child = countDirStats(node.children[k]);
      stats.files += child.files;
      stats.fns += child.fns;
      stats.lines += child.lines;
      if (child.maxCx > stats.maxCx) stats.maxCx = child.maxCx;
    });
    return stats;
  }

  function expandToFile(filePath) {
    var parts = filePath.split('/');
    var p = '';
    for (var i = 0; i < parts.length - 1; i++) {
      p = p ? p + '/' + parts[i] : parts[i];
      state.expandedDirs.add(p);
    }
  }

  function selectFile(filePath) {
    state.selectedNode = filePath;
    $detailPanel.classList.add('open');
    renderDetailPanel(filePath);
    renderFileTree();
    highlightGraphNode(filePath);
    updateHash();
  }

  function deselectFile() {
    state.selectedNode = null;
    $detailPanel.classList.remove('open');
    renderFileTree();
    clearGraphHighlight();
    updateHash();
  }

  function renderDetailPanel(filePath) {
    var f = fileMap[filePath];
    if (!f) {
      $detailBody.innerHTML = '<div class="detail-section"><p style="color:var(--text-muted)">File not found</p></div>';
      return;
    }

    var cx = fileComplexity(f);
    var usedBy = usedByMap[filePath] || [];

    var html = '';

    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Stats</div>';
    html += '<div class="detail-stats">';
    html += statBox('Lines', f.lines);
    html += statBox('Size', formatSize(f.size));
    html += statBox('Functions', f.functions.length);
    html += statBox('Complexity', cx);
    html += '</div>';
    html += '</div>';

    // Imports
    if (f.imports && f.imports.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Imports (' + f.imports.length + ')</div>';
      html += '<ul class="detail-list">';
      f.imports.forEach(function (imp) {
        var resolvedPath = resolveImportPath(filePath, imp.source);
        var isInternal = fileMap[resolvedPath];
        var cls = isInternal ? ' clickable' : '';
        html += '<li class="detail-list-item' + cls + '"' +
          (isInternal ? ' data-navigate="' + escapeHtml(resolvedPath) + '"' : '') + '>' +
          '<span style="color:var(--text-muted)">\u2190</span> ' +
          '<span>' + escapeHtml(imp.source) + '</span>' +
          '<span class="item-line">L' + imp.line + '</span></li>';
      });
      html += '</ul></div>';
    }

    // Exports
    if (f.exports && f.exports.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Exports (' + f.exports.length + ')</div>';
      html += '<ul class="detail-list">';
      f.exports.forEach(function (exp) {
        html += '<li class="detail-list-item">' +
          '<span class="badge badge-' + exp.type + '">' + exp.type + '</span> ' +
          escapeHtml(exp.name) +
          '<span class="item-line">L' + exp.line + '</span></li>';
      });
      html += '</ul></div>';
    }

    // Functions
    if (f.functions && f.functions.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Functions (' + f.functions.length + ')</div>';
      html += '<ul class="detail-list">';
      f.functions.forEach(function (fn) {
        var badges = '';
        if (fn.async) badges += '<span class="badge badge-async">async</span> ';
        badges += '<span class="badge badge-' + fn.type + '">' + fn.type + '</span> ';
        var span = (fn.endLine || fn.line) - fn.line + 1;
        html += '<li class="detail-list-item">' + badges +
          escapeHtml(fn.name) +
          (fn.params && fn.params.length > 0 ? '<span style="color:var(--text-muted)">(' + fn.params.join(', ') + ')</span>' : '') +
          '<span class="item-line">' + span + ' lines</span></li>';
      });
      html += '</ul></div>';
    }

    // Classes
    if (f.classes && f.classes.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Classes (' + f.classes.length + ')</div>';
      html += '<ul class="detail-list">';
      f.classes.forEach(function (cls) {
        html += '<li class="detail-list-item"><span class="badge badge-class">class</span> ' +
          escapeHtml(cls.name) +
          (cls.extends ? ' <span style="color:var(--text-muted)">extends ' + escapeHtml(cls.extends) + '</span>' : '') +
          '<span class="item-line">L' + cls.line + '</span></li>';
      });
      html += '</ul></div>';
    }

    // Used by
    if (usedBy.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Used by (' + usedBy.length + ')</div>';
      html += '<ul class="detail-list">';
      usedBy.forEach(function (p) {
        html += '<li class="detail-list-item clickable" data-navigate="' + escapeHtml(p) + '">' +
          '<span style="color:var(--accent-secondary)">\u2192</span> ' +
          escapeHtml(p) + '</li>';
      });
      html += '</ul></div>';
    }

    // Dependency Chain
    var chainImports = [];
    var chainUsedBy = [];
    if (f.imports) {
      f.imports.forEach(function (imp) {
        var rp = resolveImportPath(filePath, imp.source);
        if (fileMap[rp]) chainImports.push(rp);
      });
    }
    usedBy.forEach(function (p) { if (fileMap[p]) chainUsedBy.push(p); });

    if (chainImports.length > 0 || chainUsedBy.length > 0) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-title">Dependency Chain</div>';
      html += '<div class="dep-chain">';

      // Upstream: files this file imports (and their imports, 2 levels)
      if (chainImports.length > 0) {
        html += '<div class="dep-chain-group">';
        html += '<div class="dep-chain-label">imports</div>';
        chainImports.forEach(function (dep) {
          var depImports = [];
          var df = fileMap[dep];
          if (df && df.imports) {
            df.imports.forEach(function (imp) {
              var rr = resolveImportPath(dep, imp.source);
              if (fileMap[rr] && rr !== filePath) depImports.push(rr);
            });
          }
          html += '<div class="dep-chain-node" data-navigate="' + escapeHtml(dep) + '">';
          html += '<span class="dep-chain-arrow">\u2190</span>';
          html += '<span class="dep-chain-file">' + escapeHtml(dep.split('/').pop()) + '</span>';
          if (depImports.length > 0) {
            html += '<span class="dep-chain-sub">\u2190 ' + depImports.slice(0, 3).map(function (d) { return escapeHtml(d.split('/').pop()); }).join(', ');
            if (depImports.length > 3) html += ' +' + (depImports.length - 3);
            html += '</span>';
          }
          html += '</div>';
        });
        html += '</div>';
      }

      // Center: current file
      html += '<div class="dep-chain-center">' + escapeHtml(f.path.split('/').pop()) + '</div>';

      // Downstream: files that import this file (and what imports them, 2 levels)
      if (chainUsedBy.length > 0) {
        html += '<div class="dep-chain-group">';
        html += '<div class="dep-chain-label">imported by</div>';
        chainUsedBy.slice(0, 15).forEach(function (dep) {
          var depUsedBy = usedByMap[dep] || [];
          html += '<div class="dep-chain-node" data-navigate="' + escapeHtml(dep) + '">';
          html += '<span class="dep-chain-arrow">\u2192</span>';
          html += '<span class="dep-chain-file">' + escapeHtml(dep.split('/').pop()) + '</span>';
          if (depUsedBy.length > 0) {
            html += '<span class="dep-chain-sub">\u2192 ' + depUsedBy.slice(0, 3).map(function (d) { return escapeHtml(d.split('/').pop()); }).join(', ');
            if (depUsedBy.length > 3) html += ' +' + (depUsedBy.length - 3);
            html += '</span>';
          }
          html += '</div>';
        });
        if (chainUsedBy.length > 15) {
          html += '<div class="dep-chain-more">+' + (chainUsedBy.length - 15) + ' more</div>';
        }
        html += '</div>';
      }

      html += '</div></div>';
    }

    // Calls
    if (f.calls && f.calls.length > 0) {
      var uniqueCalls = [];
      var seenCalls = {};
      f.calls.forEach(function (c) {
        if (!seenCalls[c.callee]) {
          seenCalls[c.callee] = true;
          uniqueCalls.push(c);
        }
      });
      if (uniqueCalls.length > 0) {
        html += '<div class="detail-section">';
        html += '<div class="detail-section-title">Calls (' + uniqueCalls.length + ')</div>';
        html += '<ul class="detail-list">';
        uniqueCalls.forEach(function (c) {
          html += '<li class="detail-list-item"><span style="color:var(--text-muted)">\u2192</span> ' +
            '<span style="font-family:var(--font-mono)">' + escapeHtml(c.callee) + '</span>' +
            (c.caller ? '<span class="item-line">from ' + escapeHtml(c.caller) + '</span>' : '') +
            '</li>';
        });
        html += '</ul></div>';
      }
    }

    $detailBody.innerHTML = html;

    $detailBody.querySelectorAll('[data-navigate]').forEach(function (el) {
      el.addEventListener('click', function () {
        var target = el.getAttribute('data-navigate');
        if (fileMap[target]) {
          expandToFile(target);
          selectFile(target);
        }
      });
    });
  }

  function statBox(label, value) {
    return '<div class="detail-stat"><div class="detail-stat-label">' + label + '</div>' +
      '<div class="detail-stat-value">' + value + '</div></div>';
  }

  function resolveImportPath(fromFile, importSource) {
    if (!importSource.startsWith('.')) return importSource;
    var dir = fromFile.split('/').slice(0, -1);
    var parts = importSource.split('/');
    parts.forEach(function (p) {
      if (p === '..') dir.pop();
      else if (p !== '.') dir.push(p);
    });
    var resolved = dir.join('/');
    if (fileMap[resolved]) return resolved;
    var exts = ['.js', '.ts', '.svelte', '.jsx', '.tsx', '.mjs', '/index.js', '/index.ts'];
    for (var i = 0; i < exts.length; i++) {
      if (fileMap[resolved + exts[i]]) return resolved + exts[i];
    }
    return resolved;
  }

  document.getElementById('detail-close').addEventListener('click', deselectFile);

  document.getElementById('sidebar-toggle').addEventListener('click', function () {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    $sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  });

  $searchInput.addEventListener('input', debounce(function () {
    state.searchQuery = $searchInput.value.trim().toLowerCase();
    renderSearchResults();
  }, 150));

  $searchInput.addEventListener('focus', function () {
    if (state.searchQuery.length > 0) {
      $searchResults.classList.remove('hidden');
    }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search-container')) {
      $searchResults.classList.add('hidden');
    }
  });

  function renderSearchResults() {
    if (state.searchQuery.length === 0) {
      $searchResults.classList.add('hidden');
      return;
    }

    var results = [];
    var q = state.searchQuery;

    // Search files
    data.files.forEach(function (f) {
      if (f.path.toLowerCase().includes(q)) {
        results.push({ type: 'file', path: f.path, display: f.path, meta: f.lines + ' lines' });
      }
    });

    // Search functions
    data.files.forEach(function (f) {
      f.functions.forEach(function (fn) {
        if (fn.name.toLowerCase().includes(q)) {
          results.push({ type: 'fn', path: f.path, display: fn.name, meta: f.path });
        }
      });
    });

    // Search routes
    if (data.routes) {
      data.routes.forEach(function (r) {
        if (r.path.toLowerCase().includes(q)) {
          results.push({ type: 'route', path: r.file, display: r.path, meta: r.type });
        }
      });
    }

    results = results.slice(0, 20);

    if (results.length === 0) {
      $searchResults.innerHTML = '<div class="search-result-item"><span class="result-text" style="color:var(--text-muted)">No results found</span></div>';
    } else {
      $searchResults.innerHTML = results.map(function (r) {
        var icon = r.type === 'file' ? '\uD83D\uDCC4' : r.type === 'fn' ? 'f' : '\u2192';
        var highlighted = highlightMatch(r.display, state.searchQuery);
        return '<div class="search-result-item" data-search-path="' + escapeHtml(r.path) + '">' +
          '<span class="result-icon">' + icon + '</span>' +
          '<span class="result-text">' + highlighted + '</span>' +
          '<span class="result-meta">' + escapeHtml(r.meta) + '</span></div>';
      }).join('');
    }

    $searchResults.classList.remove('hidden');

    $searchResults.querySelectorAll('[data-search-path]').forEach(function (el) {
      el.addEventListener('click', function () {
        var target = el.getAttribute('data-search-path');
        if (fileMap[target]) {
          expandToFile(target);
          selectFile(target);
          $searchResults.classList.add('hidden');
          $searchInput.blur();
        }
      });
    });
  }

  function highlightMatch(text, query) {
    var idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.substring(0, idx)) +
      '<mark>' + escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' +
      escapeHtml(text.substring(idx + query.length));
  }

  function renderMain() {
    switch (state.view) {
      case 'tree': renderTreeView(); break;
      case 'treemap': renderTreemapView(); break;
      case 'routes': renderRoutesView(); break;
      case 'insights': renderInsightsView(); break;
      default: state.view = 'tree'; renderTreeView(); break;
    }
  }

  function highlightGraphNode() {}
  function clearGraphHighlight() {}


  function showTooltip(event, content) {
    $tooltip.innerHTML = content;
    $tooltip.classList.add('visible');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    var x = event.clientX + 14;
    var y = event.clientY + 14;
    var tw = $tooltip.offsetWidth;
    var th = $tooltip.offsetHeight;
    if (x + tw > window.innerWidth - 10) x = event.clientX - tw - 10;
    if (y + th > window.innerHeight - 10) y = event.clientY - th - 10;
    $tooltip.style.left = x + 'px';
    $tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    $tooltip.classList.remove('visible');
  }

  function renderTreeView() {
    var tree = buildFileTree();
    var html = '<div class="tree-view"><div class="tree-view-list">';
    html += renderTreeViewNode(tree, 0, '');
    html += '</div></div>';
    $main.innerHTML = html;

    $main.querySelectorAll('[data-tree-file]').forEach(function (el) {
      el.addEventListener('click', function () {
        expandToFile(el.dataset.treeFile);
        selectFile(el.dataset.treeFile);
      });
    });

    $main.querySelectorAll('[data-tree-dir]').forEach(function (el) {
      el.addEventListener('click', function () {
        var dir = el.dataset.treeDir;
        if (state.expandedDirs.has(dir)) {
          state.expandedDirs.delete(dir);
        } else {
          state.expandedDirs.add(dir);
        }
        renderTreeView();
      });
    });
  }

  function renderTreeViewNode(node, depth, pathPrefix) {
    var html = '';
    var dirs = Object.keys(node.children).sort();
    var files = node.files.slice().sort(function (a, b) {
      return a.path.localeCompare(b.path);
    });

    dirs.forEach(function (dirName) {
      var dirPath = pathPrefix ? pathPrefix + '/' + dirName : dirName;
      var child = node.children[dirName];
      var isExpanded = state.expandedDirs.has(dirPath);
      var ds = countDirStats(child);
      var pl = depth * 20 + 12;

      html += '<div class="tree-item directory" style="padding-left:' + pl + 'px" data-tree-dir="' + escapeHtml(dirPath) + '">' +
        '<span class="tree-chevron ' + (isExpanded ? 'open' : '') + '">\u25B6</span>' +
        '<span class="tree-icon dir">\uD83D\uDCC1</span>' +
        '<span class="tree-label">' + escapeHtml(dirName) + '</span>' +
        '<span class="tree-metrics">' +
          '<span class="tree-metric tm-fns" title="Functions">' + ds.fns + ' fn</span>' +
          '<span class="tree-metric tm-lines" title="Lines">' + ds.lines + '</span>' +
        '</span>' +
        '<span class="tree-badge">' + ds.files + '</span></div>';

      if (isExpanded) {
        html += renderTreeViewNode(child, depth + 1, dirPath);
      }
    });

    files.forEach(function (f) {
      var fileName = f.path.split('/').pop();
      var ext = f.extension || '';
      var iconInfo = extIcons[ext] || { icon: '\u2022', cls: '' };
      var cx = fileComplexity(f);
      var cxColor = cx < 10 ? '#3fb950' : cx < 25 ? '#d29922' : '#f85149';
      var cxWidth = Math.min(cx, 60);
      var fnCount = f.functions ? f.functions.length : 0;
      var coupling = usedByMap[f.path] ? usedByMap[f.path].length : 0;
      var pl = depth * 20 + 12;

      html += '<div class="tree-item" style="padding-left:' + pl + 'px" data-tree-file="' + escapeHtml(f.path) + '">' +
        '<span class="tree-indent"></span>' +
        '<span class="tree-icon ' + iconInfo.cls + '">' + iconInfo.icon + '</span>' +
        '<span class="tree-label">' + escapeHtml(fileName) + '</span>' +
        '<span class="tree-metrics">' +
          (fnCount > 0 ? '<span class="tree-metric tm-fns" title="' + fnCount + ' functions">' + fnCount + ' fn</span>' : '') +
          (coupling > 0 ? '<span class="tree-metric tm-coupling" title="Imported by ' + coupling + ' files">' + coupling + '\u2191</span>' : '') +
        '</span>' +
        '<span class="tree-cx-bar" title="Complexity: ' + cx + '">' +
          '<span class="tree-cx-fill" style="width:' + cxWidth + '%;background:' + cxColor + '"></span>' +
        '</span>' +
        '<span class="tree-badge">' + f.lines + ' lines</span></div>';
    });

    return html;
  }

  // Squarified treemap layout
  function squarify(items, x, y, w, h) {
    if (items.length === 0) return [];
    var rects = [];
    var total = 0;
    items.forEach(function (it) { total += it.value; });
    if (total === 0) return [];

    var remaining = items.slice();
    var cx = x, cy = y, cw = w, ch = h;

    while (remaining.length > 0) {
      var isWide = cw >= ch;
      var side = isWide ? ch : cw;
      var row = [];
      var rowSum = 0;
      var worst = Infinity;

      for (var i = 0; i < remaining.length; i++) {
        var testRow = row.concat([remaining[i]]);
        var testSum = rowSum + remaining[i].value;
        var testWorst = worstRatio(testRow, testSum, side, total, cw * ch);
        if (testWorst <= worst || row.length === 0) {
          row = testRow;
          rowSum = testSum;
          worst = testWorst;
        } else {
          break;
        }
      }

      remaining = remaining.slice(row.length);
      var rowFrac = rowSum / total;
      var rowSize = isWide ? cw * rowFrac : ch * rowFrac;

      var offset = 0;
      row.forEach(function (it) {
        var frac = rowSum > 0 ? it.value / rowSum : 0;
        var itemSize = (isWide ? ch : cw) * frac;
        if (isWide) {
          rects.push({ item: it, x: cx, y: cy + offset, w: rowSize, h: itemSize });
        } else {
          rects.push({ item: it, x: cx + offset, y: cy, w: itemSize, h: rowSize });
        }
        offset += itemSize;
      });

      if (isWide) {
        cx += rowSize;
        cw -= rowSize;
      } else {
        cy += rowSize;
        ch -= rowSize;
      }
      total -= rowSum;
    }
    return rects;
  }

  function worstRatio(row, rowSum, side, totalVal, area) {
    var worst = 0;
    var rowArea = (rowSum / totalVal) * area;
    var rowSide = rowArea / side;
    row.forEach(function (it) {
      var itemArea = (it.value / totalVal) * area;
      var itemSide = itemArea / rowSide;
      var ratio = Math.max(itemSide / rowSide, rowSide / itemSide);
      if (ratio > worst) worst = ratio;
    });
    return worst;
  }

  var treemapDrillPath = '';

  function renderTreemapView() {
    var tree = buildFileTree();

    // Navigate to drill target
    var target = tree;
    if (treemapDrillPath) {
      var parts = treemapDrillPath.split('/');
      for (var i = 0; i < parts.length; i++) {
        if (target.children[parts[i]]) {
          target = target.children[parts[i]];
        } else {
          treemapDrillPath = '';
          target = tree;
          break;
        }
      }
    }

    // Build treemap items from directories and files
    var items = [];
    Object.keys(target.children).sort().forEach(function (dirName) {
      var child = target.children[dirName];
      var ds = countDirStats(child);
      if (ds.lines > 0) {
        var dirPath = treemapDrillPath ? treemapDrillPath + '/' + dirName : dirName;
        var dirColorKey = dirPath.split('/').slice(0, 2).join('/');
        items.push({ type: 'dir', name: dirName, path: dirPath, value: ds.lines, stats: ds, color: getDirColor(dirColorKey) });
      }
    });
    target.files.forEach(function (f) {
      var cx = fileComplexity(f);
      var cxColor = cx < 10 ? '#3fb950' : cx < 25 ? '#d29922' : '#f85149';
      var dirKey = f.path.split('/').slice(0, 2).join('/');
      items.push({ type: 'file', name: f.path.split('/').pop(), path: f.path, value: f.lines || 1, color: getDirColor(dirKey), cxColor: cxColor, cx: cx, file: f });
    });

    items.sort(function (a, b) { return b.value - a.value; });

    // Breadcrumb
    var html = '<div class="treemap-container">';
    html += '<div class="treemap-breadcrumb">';
    html += '<span class="treemap-crumb" data-treemap-drill="">\u25C0 All</span>';
    if (treemapDrillPath) {
      var crumbParts = treemapDrillPath.split('/');
      var crumbPath = '';
      crumbParts.forEach(function (p, idx) {
        crumbPath += (idx > 0 ? '/' : '') + p;
        html += ' <span class="treemap-crumb-sep">/</span> ';
        html += '<span class="treemap-crumb" data-treemap-drill="' + escapeHtml(crumbPath) + '">' + escapeHtml(p) + '</span>';
      });
    }
    html += '</div>';

    html += '<div class="treemap-area" id="treemap-area"></div>';
    html += '</div>';

    $main.innerHTML = html;

    // Layout after DOM insertion so we can measure the area
    var area = document.getElementById('treemap-area');
    var W = area.clientWidth;
    var H = area.clientHeight;

    if (items.length === 0 || W === 0 || H === 0) {
      area.innerHTML = '<div class="empty-state"><div class="empty-state-title">No files</div></div>';
      return;
    }

    var rects = squarify(items, 0, 0, W, H);
    var PAD = 2;

    var rectsHtml = '';
    rects.forEach(function (r, idx) {
      var it = r.item;
      var rx = r.x + PAD;
      var ry = r.y + PAD;
      var rw = Math.max(r.w - PAD * 2, 0);
      var rh = Math.max(r.h - PAD * 2, 0);
      if (rw < 1 || rh < 1) return;

      var isDir = it.type === 'dir';
      var bgColor = isDir ? it.color + '22' : it.color + '44';
      var borderColor = isDir ? it.color + '66' : it.color + '88';
      var showLabel = rw > 30 && rh > 16;
      var showValue = rw > 50 && rh > 30;

      rectsHtml += '<div class="treemap-rect' + (isDir ? ' treemap-dir' : ' treemap-file') + '" ' +
        'data-treemap-idx="' + idx + '" ' +
        (isDir ? 'data-treemap-drill="' + escapeHtml(it.path) + '"' : 'data-treemap-file="' + escapeHtml(it.path) + '"') +
        ' style="left:' + rx + 'px;top:' + ry + 'px;width:' + rw + 'px;height:' + rh + 'px;' +
        'background:' + bgColor + ';border-color:' + borderColor + '"' +
        ' title="' + escapeHtml(it.name) + ' — ' + it.value + ' lines' + (it.cx ? ' (cx:' + it.cx + ')' : '') + '">';

      if (isDir && showLabel) {
        rectsHtml += '<span class="treemap-label treemap-dir-label" style="color:' + it.color + '">\uD83D\uDCC1 ' + escapeHtml(it.name) + '</span>';
        if (showValue) rectsHtml += '<span class="treemap-value">' + it.stats.files + ' files \u00B7 ' + it.value + ' lines</span>';
      } else if (!isDir && showLabel) {
        rectsHtml += '<span class="treemap-label">' + escapeHtml(it.name) + '</span>';
        if (showValue) rectsHtml += '<span class="treemap-value">' + it.value + ' lines</span>';
        if (it.cx > 0 && rw > 40 && rh > 40) {
          rectsHtml += '<span class="treemap-cx" style="background:' + it.cxColor + '"></span>';
        }
      }

      rectsHtml += '</div>';
    });

    area.innerHTML = rectsHtml;

    // Event: drill into directories
    area.querySelectorAll('[data-treemap-drill]').forEach(function (el) {
      el.addEventListener('click', function () {
        treemapDrillPath = el.dataset.treemapDrill;
        renderTreemapView();
      });
    });

    // Event: click file → detail panel
    area.querySelectorAll('[data-treemap-file]').forEach(function (el) {
      el.addEventListener('click', function () {
        var fp = el.dataset.treemapFile;
        if (fileMap[fp]) {
          expandToFile(fp);
          selectFile(fp);
        }
      });
    });

    // Breadcrumb navigation
    $main.querySelectorAll('[data-treemap-drill]').forEach(function (el) {
      if (el.classList.contains('treemap-crumb')) {
        el.addEventListener('click', function () {
          treemapDrillPath = el.dataset.treemapDrill;
          renderTreemapView();
        });
      }
    });
  }

  function renderRoutesView() {
    var routes = data.routes || [];

    if (routes.length === 0) {
      $main.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\u2192</div>' +
        '<div class="empty-state-title">No routes detected</div>' +
        '<div class="empty-state-desc">Routes are detected from SvelteKit file-based routing (+page, +server, +layout).</div></div>';
      return;
    }

    // Count methods
    var methodCounts = {};
    var typeCounts = { page: 0, api: 0, layout: 0, error: 0 };
    routes.forEach(function (r) {
      var methods = r.methods || [];
      if (methods.length === 0 && r.type === 'page') methods = ['GET'];
      methods.forEach(function (m) {
        methodCounts[m] = (methodCounts[m] || 0) + 1;
      });
      if (typeCounts[r.type] !== undefined) typeCounts[r.type]++;
    });

    // Group by prefix
    var groups = {};
    routes.forEach(function (r) {
      var prefix = r.path.split('/').slice(0, 3).join('/') || '/';
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(r);
    });

    var html = '<div class="routes-view">';

    // Summary bar
    html += '<div class="routes-summary">';
    html += '<div class="routes-summary-total">' + routes.length + ' routes</div>';
    html += '<div class="routes-summary-methods">';
    var methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    methodOrder.forEach(function (m) {
      if (methodCounts[m]) {
        html += '<span class="routes-method-count badge-' + m.toLowerCase() + '" data-method="' + m + '" style="cursor:pointer" title="Click to filter">' + m + ' <strong>' + methodCounts[m] + '</strong></span>';
      }
    });
    // any other methods
    Object.keys(methodCounts).forEach(function (m) {
      if (methodOrder.indexOf(m) === -1) {
        html += '<span class="routes-method-count" data-method="' + m + '" style="cursor:pointer" title="Click to filter">' + m + ' <strong>' + methodCounts[m] + '</strong></span>';
      }
    });
    html += '</div>';
    html += '<div class="routes-summary-types">';
    Object.keys(typeCounts).forEach(function (t) {
      if (typeCounts[t] > 0) {
        html += '<span class="routes-type-count">' + t + ' <strong>' + typeCounts[t] + '</strong></span>';
      }
    });
    html += '</div>';
    html += '</div>';

    Object.keys(groups).sort().forEach(function (prefix) {
      html += '<div class="routes-group">';
      html += '<div class="routes-group-title">' + escapeHtml(prefix) + '</div>';

      groups[prefix].forEach(function (r) {
        var methods = (r.methods || []);
        if (methods.length === 0 && r.type === 'page') methods = ['GET'];
        var methodBadges = methods.map(function (m) {
          return '<span class="badge badge-' + m.toLowerCase() + '">' + m + '</span>';
        }).join(' ');

        var typeBadge = '<span class="badge badge-' + r.type + '">' + r.type + '</span>';

        html += '<div class="route-row" data-route-file="' + escapeHtml(r.file) + '" data-methods="' + methods.join(',') + '">' +
          '<div class="route-methods">' + methodBadges + '</div>' +
          '<div class="route-path">' + escapeHtml(r.path) + '</div>' +
          '<div class="route-file">' + escapeHtml(r.file.split('/').pop()) + '</div>' +
          '<div class="route-type">' + typeBadge + '</div></div>';
      });

      html += '</div>';
    });

    html += '</div>';
    $main.innerHTML = html;

    $main.querySelectorAll('[data-route-file]').forEach(function (el) {
      el.addEventListener('click', function () {
        var fp = el.dataset.routeFile;
        if (fileMap[fp]) {
          expandToFile(fp);
          selectFile(fp);
        }
      });
    });

    // Method filter toggle
    var activeFilters = {};
    $main.querySelectorAll('.routes-method-count[data-method]').forEach(function (badge) {
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        var method = badge.dataset.method;
        if (activeFilters[method]) {
          delete activeFilters[method];
          badge.classList.remove('method-filter-active');
        } else {
          activeFilters[method] = true;
          badge.classList.add('method-filter-active');
        }
        var hasActiveFilter = Object.keys(activeFilters).length > 0;
        $main.querySelectorAll('.route-row').forEach(function (row) {
          if (!hasActiveFilter) {
            row.style.display = '';
            return;
          }
          var rowMethods = (row.dataset.methods || '').split(',');
          var match = false;
          rowMethods.forEach(function (rm) { if (activeFilters[rm]) match = true; });
          row.style.display = match ? '' : 'none';
        });
        // Show/hide empty groups
        $main.querySelectorAll('.routes-group').forEach(function (grp) {
          var visible = grp.querySelectorAll('.route-row:not([style*="display: none"])');
          grp.style.display = visible.length > 0 ? '' : 'none';
        });
      });
    });
  }

  function shortPath(fp) {
    var parts = fp.split('/');
    if (parts.length <= 2) return fp;
    return parts.slice(-2).join('/');
  }

  function renderInsightsView() {
    var ins = data.insights || {};
    var circular = ins.circular || [];
    var deadExports = ins.deadExports || [];
    var orphans = ins.orphans || [];

    var complexityData = [];
    data.files.forEach(function (f) {
      var cx = fileComplexity(f);
      if (cx > 0) complexityData.push({ path: f.path, complexity: cx, lines: f.lines });
    });
    complexityData.sort(function (a, b) { return b.complexity - a.complexity; });
    var topComplex = complexityData.slice(0, 20);
    var maxCx = topComplex.length > 0 ? topComplex[0].complexity : 1;

    var couplingData = [];
    Object.keys(usedByMap).forEach(function (fp) {
      couplingData.push({ path: fp, count: usedByMap[fp].length });
    });
    couplingData.sort(function (a, b) { return b.count - a.count; });
    var topCoupling = couplingData.slice(0, 15);
    var maxCoupling = topCoupling.length > 0 ? topCoupling[0].count : 1;

    // Risk Hotspots: files that are BOTH complex AND highly imported
    var riskData = [];
    data.files.forEach(function (f) {
      var cx = fileComplexity(f);
      var coupling = usedByMap[f.path] ? usedByMap[f.path].length : 0;
      if (cx > 5 && coupling > 2) {
        riskData.push({ path: f.path, complexity: cx, coupling: coupling, risk: cx * coupling, lines: f.lines });
      }
    });
    riskData.sort(function (a, b) { return b.risk - a.risk; });
    var topRisk = riskData.slice(0, 20);
    var maxRisk = topRisk.length > 0 ? topRisk[0].risk : 1;

    // Project Health Score (0-100)
    var totalFiles = data.files.length || 1;
    var avgCx = 0;
    if (complexityData.length > 0) {
      var cxSum = 0;
      complexityData.forEach(function (c) { cxSum += c.complexity; });
      avgCx = cxSum / complexityData.length;
    }
    var circularPenalty = Math.min(circular.length * 8, 30);
    var deadPenalty = Math.min(Math.round((deadExports.length / totalFiles) * 40), 20);
    var orphanPenalty = Math.min(Math.round((orphans.length / totalFiles) * 30), 15);
    var cxPenalty = Math.min(Math.round(avgCx * 0.8), 25);
    var riskPenalty = Math.min(topRisk.length * 2, 10);
    var healthScore = Math.max(0, 100 - circularPenalty - deadPenalty - orphanPenalty - cxPenalty - riskPenalty);
    var scoreColor = healthScore >= 80 ? '#3fb950' : healthScore >= 60 ? '#d29922' : '#f85149';
    var scoreLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 60 ? 'Fair' : 'Needs Work';
    var scoreRadius = 54;
    var scoreCircum = 2 * Math.PI * scoreRadius;
    var scoreDash = Math.round((healthScore / 100) * scoreCircum);

    var html = '<div class="insights-view">';

    // Health Score + Summary
    html += '<div class="health-row">';

    // Score circle
    html += '<div class="health-score">';
    html += '<svg width="128" height="128" viewBox="0 0 128 128">';
    html += '<circle cx="64" cy="64" r="' + scoreRadius + '" fill="none" stroke="var(--bg-tertiary)" stroke-width="7"/>';
    html += '<circle cx="64" cy="64" r="' + scoreRadius + '" fill="none" stroke="' + scoreColor + '" stroke-width="7" ' +
      'stroke-dasharray="' + scoreDash + ' ' + scoreCircum + '" stroke-linecap="round" ' +
      'transform="rotate(-90 64 64)" style="transition:stroke-dasharray 0.6s"/>';
    html += '<text x="64" y="58" text-anchor="middle" fill="' + scoreColor + '" font-size="32" font-weight="700" font-family="var(--font-mono)">' + healthScore + '</text>';
    html += '<text x="64" y="78" text-anchor="middle" fill="var(--text-muted)" font-size="11">' + scoreLabel + '</text>';
    html += '</svg>';
    html += '</div>';

    // Summary items
    html += '<div class="health-details">';
    html += '<div class="insight-summary">';
    html += '<div class="insight-summary-item' + (circular.length > 0 ? ' has-issues' : '') + '">' +
      '<span class="insight-summary-val">' + circular.length + '</span>' +
      '<span class="insight-summary-lbl">Circular</span></div>';
    html += '<div class="insight-summary-item' + (deadExports.length > 0 ? ' has-issues' : '') + '">' +
      '<span class="insight-summary-val">' + deadExports.length + '</span>' +
      '<span class="insight-summary-lbl">Dead Exports</span></div>';
    html += '<div class="insight-summary-item' + (orphans.length > 0 ? ' has-issues' : '') + '">' +
      '<span class="insight-summary-val">' + orphans.length + '</span>' +
      '<span class="insight-summary-lbl">Orphans</span></div>';
    html += '<div class="insight-summary-item' + (topRisk.length > 0 ? ' has-issues' : '') + '">' +
      '<span class="insight-summary-val">' + topRisk.length + '</span>' +
      '<span class="insight-summary-lbl">Risk Hotspots</span></div>';
    html += '</div>';

    // Score breakdown
    html += '<div class="health-breakdown">';
    if (circularPenalty > 0) html += '<span class="health-bp">-' + circularPenalty + ' circular</span>';
    if (deadPenalty > 0) html += '<span class="health-bp">-' + deadPenalty + ' dead exports</span>';
    if (orphanPenalty > 0) html += '<span class="health-bp">-' + orphanPenalty + ' orphans</span>';
    if (cxPenalty > 0) html += '<span class="health-bp">-' + cxPenalty + ' complexity</span>';
    if (riskPenalty > 0) html += '<span class="health-bp">-' + riskPenalty + ' risk hotspots</span>';
    if (healthScore === 100) html += '<span class="health-bp" style="color:#3fb950">Perfect</span>';
    html += '</div>';

    html += '</div>'; // health-details
    html += '</div>'; // health-row

    // Risk Hotspots — full width, above the grid
    html += insightSection('risk', 'Risk Hotspots', topRisk.length, 'error',
      topRisk.length === 0 ? '<div class="insight-empty">No files with both high complexity and high coupling.</div>' :
        '<div class="insight-risk-desc">Files that are complex <em>and</em> heavily imported — riskiest to change.</div>' +
        topRisk.map(function (item) {
          var pct = Math.round((item.risk / maxRisk) * 100);
          var cxPct = Math.round(Math.min(item.complexity / 60, 1) * 100);
          var cpPct = Math.round(Math.min(item.coupling / maxCoupling, 1) * 100);
          var color = item.risk > maxRisk * 0.6 ? '#f85149' : item.risk > maxRisk * 0.3 ? '#d29922' : '#58a6ff';
          return '<div class="hotspot-bar risk-bar" data-insight-file="' + escapeHtml(item.path) + '">' +
            '<span class="hotspot-label" title="' + escapeHtml(item.path) + '">' + escapeHtml(shortPath(item.path)) + '</span>' +
            '<div class="risk-tracks">' +
              '<div class="risk-track"><div class="hotspot-fill" style="width:' + cxPct + '%;background:#d29922" title="Complexity: ' + item.complexity + '"></div></div>' +
              '<div class="risk-track"><div class="hotspot-fill" style="width:' + cpPct + '%;background:#58a6ff" title="Coupling: ' + item.coupling + '"></div></div>' +
            '</div>' +
            '<span class="hotspot-value risk-value" style="color:' + color + '">' + item.risk + '</span></div>';
        }).join('') +
        '<div class="risk-legend"><span class="risk-legend-item"><span class="risk-legend-dot" style="background:#d29922"></span>complexity</span>' +
        '<span class="risk-legend-item"><span class="risk-legend-dot" style="background:#58a6ff"></span>coupling</span>' +
        '<span class="risk-legend-item" style="color:var(--text-muted)">score = complexity \u00D7 coupling</span></div>'
    );

    // Two-column grid for charts
    html += '<div class="insight-grid">';

    // Complexity Hotspots
    html += insightSection('complexity', 'Complexity Hotspots', topComplex.length, 'warning',
      topComplex.length === 0 ? '<div class="insight-empty">No complexity data.</div>' :
        topComplex.map(function (item) {
          var pct = Math.round((item.complexity / maxCx) * 100);
          var color = item.complexity < 10 ? '#3fb950' : item.complexity < 25 ? '#d29922' : '#f85149';
          return '<div class="hotspot-bar" data-insight-file="' + escapeHtml(item.path) + '">' +
            '<span class="hotspot-label" title="' + escapeHtml(item.path) + '">' + escapeHtml(shortPath(item.path)) + '</span>' +
            '<div class="hotspot-track"><div class="hotspot-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
            '<span class="hotspot-value">' + item.complexity + '</span></div>';
        }).join('')
    );

    // High Coupling
    html += insightSection('coupling', 'High Coupling', topCoupling.length, 'info',
      topCoupling.length === 0 ? '<div class="insight-empty">No coupling data.</div>' :
        topCoupling.map(function (item) {
          var pct = Math.round((item.count / maxCoupling) * 100);
          return '<div class="hotspot-bar" data-insight-file="' + escapeHtml(item.path) + '">' +
            '<span class="hotspot-label" title="' + escapeHtml(item.path) + '">' + escapeHtml(shortPath(item.path)) + '</span>' +
            '<div class="hotspot-track"><div class="hotspot-fill" style="width:' + pct + '%;background:var(--accent)"></div></div>' +
            '<span class="hotspot-value">' + item.count + '</span></div>';
        }).join('')
    );

    html += '</div>'; // close insight-grid

    // Circular Dependencies
    html += insightSection('circular', 'Circular Dependencies', circular.length, 'error',
      circular.length === 0 ? '<div class="insight-empty">None found.</div>' :
        circular.map(function (cycle) {
          var chain = (Array.isArray(cycle) ? cycle : cycle.cycle || [cycle]);
          var chainHtml = '<div class="cycle-chain">';
          chain.forEach(function (node, i) {
            var label = typeof node === 'string' ? node.split('/').pop() : String(node);
            chainHtml += '<span class="cycle-node" title="' + escapeHtml(typeof node === 'string' ? node : String(node)) + '">' + escapeHtml(label) + '</span>';
            if (i < chain.length - 1) chainHtml += '<span class="cycle-arrow">\u2192</span>';
          });
          if (chain.length > 0) {
            var firstLabel = typeof chain[0] === 'string' ? chain[0].split('/').pop() : String(chain[0]);
            chainHtml += '<span class="cycle-arrow">\u2192</span><span class="cycle-node" style="border:1px solid var(--error)">' + escapeHtml(firstLabel) + '</span>';
          }
          chainHtml += '</div>';
          return '<div class="insight-card">' + chainHtml + '</div>';
        }).join('')
    );

    // Dead Exports (compact table)
    html += insightSection('deadExports', 'Dead Exports', deadExports.length, 'warning',
      deadExports.length === 0 ? '<div class="insight-empty">None found.</div>' :
        '<div class="insight-table"><div class="insight-table-head"><span class="insight-col-export">Export</span><span class="insight-col-file">File</span></div>' +
        deadExports.map(function (d) {
          var filePath = d.file || d.path || '';
          var exportName = d.name || d.export || '';
          var line = d.line || '';
          return '<div class="insight-table-row" data-insight-file="' + escapeHtml(filePath) + '">' +
            '<span class="insight-col-export">' + escapeHtml(exportName) + '</span>' +
            '<span class="insight-col-file" title="' + escapeHtml(filePath) + '">' + escapeHtml(shortPath(filePath)) + (line ? ':' + line : '') + '</span></div>';
        }).join('') + '</div>'
    );

    // Duplicate Import Paths
    // Detect $lib prefix for alias resolution
    var libPrefix = 'src/lib';
    data.files.forEach(function (f) {
      if (f.path.startsWith('src/lib/')) libPrefix = 'src/lib';
      else if (f.path.startsWith('lib/')) libPrefix = 'lib';
    });

    function resolveImportFull(fromFile, importSource) {
      // Handle $lib alias
      if (importSource.startsWith('$lib/')) {
        var aliased = libPrefix + importSource.substring(4);
        if (fileMap[aliased]) return aliased;
        var aliasExts = ['.js', '.ts', '.svelte', '.jsx', '.tsx', '/index.js', '/index.ts'];
        for (var ae = 0; ae < aliasExts.length; ae++) {
          if (fileMap[aliased + aliasExts[ae]]) return aliased + aliasExts[ae];
        }
        return aliased;
      }
      return resolveImportPath(fromFile, importSource);
    }

    var dupImports = [];
    var targetPathMap = {}; // resolved target -> { rawSource -> [fromFiles] }
    if (data.graph && data.graph.edges) {
      // Build edge map: source file -> [target paths]
      var edgeTargetsBySource = {};
      data.graph.edges.forEach(function (e) {
        if (e.external) return;
        if (!edgeTargetsBySource[e.source]) edgeTargetsBySource[e.source] = [];
        edgeTargetsBySource[e.source].push(e.target);
      });

      // For each file, match its imports to edge targets
      data.files.forEach(function (f) {
        if (!f.imports) return;
        var edgeTargets = (edgeTargetsBySource[f.path] || []).slice();
        f.imports.forEach(function (imp) {
          // Try full resolve (handles relative + $lib)
          var resolved = resolveImportFull(f.path, imp.source);
          var matchedTarget = null;
          var idx = edgeTargets.indexOf(resolved);
          if (idx !== -1) {
            matchedTarget = resolved;
            edgeTargets.splice(idx, 1);
          } else {
            // Fallback: match by filename against remaining edges
            var rawFile = imp.source.split('/').pop().replace(/\.(js|ts|svelte|jsx|tsx|mjs)$/, '');
            for (var j = 0; j < edgeTargets.length; j++) {
              var edgeFile = edgeTargets[j].split('/').pop().replace(/\.(js|ts|svelte|jsx|tsx|mjs)$/, '');
              if (rawFile === edgeFile) {
                matchedTarget = edgeTargets[j];
                edgeTargets.splice(j, 1);
                break;
              }
            }
          }
          if (matchedTarget) {
            if (!targetPathMap[matchedTarget]) targetPathMap[matchedTarget] = {};
            if (!targetPathMap[matchedTarget][imp.source]) targetPathMap[matchedTarget][imp.source] = [];
            targetPathMap[matchedTarget][imp.source].push(f.path);
          }
        });
      });
    }
    Object.keys(targetPathMap).forEach(function (target) {
      var paths = Object.keys(targetPathMap[target]);
      if (paths.length > 1) {
        dupImports.push({ target: target, paths: paths.map(function (p) { return { raw: p, files: targetPathMap[target][p] }; }) });
      }
    });
    dupImports.sort(function (a, b) { return b.paths.length - a.paths.length; });

    html += insightSection('dupImports', 'Duplicate Import Paths', dupImports.length, 'warning',
      dupImports.length === 0 ? '<div class="insight-empty">No inconsistent import paths found.</div>' :
        '<div class="insight-risk-desc">Same module imported via different paths — pick one and be consistent.</div>' +
        dupImports.slice(0, 20).map(function (dup) {
          var inner = '<div class="dup-target" data-insight-file="' + escapeHtml(dup.target) + '">' + escapeHtml(shortPath(dup.target)) + '</div>';
          inner += '<div class="dup-paths">';
          dup.paths.forEach(function (p) {
            inner += '<div class="dup-path-row">' +
              '<code class="dup-raw">' + escapeHtml(p.raw) + '</code>' +
              '<span class="dup-count">' + p.files.length + ' file' + (p.files.length > 1 ? 's' : '') + '</span>' +
              '</div>';
          });
          inner += '</div>';
          return '<div class="insight-card">' + inner + '</div>';
        }).join('')
    );

    // Import/Export Mismatch
    var mismatches = [];
    if (data.graph && data.graph.edges) {
      // Pre-compute which files have wildcard re-exports (export * from ...)
      var hasWildcardReexport = {};
      data.files.forEach(function (f) {
        if (f.exports) {
          f.exports.forEach(function (exp) {
            if (exp.type === 'reexport-all' || exp.name === '*') hasWildcardReexport[f.path] = true;
          });
        }
      });

      data.graph.edges.forEach(function (e) {
        if (e.external) return;
        var targetFile = fileMap[e.target];
        if (!targetFile) return;
        var specs = e.specifiers || [];
        if (specs.length === 0) return;

        // Skip files with export * — can't know their full export surface
        if (hasWildcardReexport[e.target]) return;

        var exportNames = {};
        if (targetFile.exports) {
          targetFile.exports.forEach(function (exp) { exportNames[exp.name] = true; });
        }

        // Svelte files always have an implicit default export (the component itself)
        if (e.target.endsWith('.svelte')) {
          exportNames['default'] = true;
        }

        specs.forEach(function (sp) {
          if (sp.type === 'namespace') return; // import * is always valid
          var lookFor = sp.imported || sp.local;
          if (!lookFor || lookFor === '*') return;
          if (!exportNames[lookFor]) {
            mismatches.push({ from: e.source, to: e.target, name: lookFor, line: 0 });
          }
        });
      });
    }
    // Deduplicate
    var mismatchMap = {};
    mismatches.forEach(function (m) {
      var key = m.from + ':' + m.to + ':' + m.name;
      if (!mismatchMap[key]) mismatchMap[key] = m;
    });
    var uniqueMismatches = Object.keys(mismatchMap).map(function (k) { return mismatchMap[k]; });
    uniqueMismatches.sort(function (a, b) { return a.to.localeCompare(b.to) || a.name.localeCompare(b.name); });

    html += insightSection('mismatches', 'Import/Export Mismatches', uniqueMismatches.length, 'error',
      uniqueMismatches.length === 0 ? '<div class="insight-empty">All imports match their target exports.</div>' :
        '<div class="insight-risk-desc">Imported names not found in the target file\'s exports — possible broken references.</div>' +
        '<div class="insight-table"><div class="insight-table-head">' +
          '<span class="insight-col-export">Import</span>' +
          '<span class="insight-col-file">From \u2192 Target</span></div>' +
        uniqueMismatches.slice(0, 50).map(function (m) {
          return '<div class="insight-table-row" data-insight-file="' + escapeHtml(m.from) + '">' +
            '<span class="insight-col-export" style="color:var(--error)">' + escapeHtml(m.name) + '</span>' +
            '<span class="insight-col-file" title="' + escapeHtml(m.from) + ' \u2192 ' + escapeHtml(m.to) + '">' +
              escapeHtml(shortPath(m.from)) + ' <span style="color:var(--text-muted)">\u2192</span> ' + escapeHtml(shortPath(m.to)) +
            '</span></div>';
        }).join('') + '</div>'
    );

    // Orphan Files (compact list)
    html += insightSection('orphans', 'Orphan Files', orphans.length, 'info',
      orphans.length === 0 ? '<div class="insight-empty">None found.</div>' :
        '<div class="insight-table">' +
        orphans.map(function (o) {
          var fp = typeof o === 'string' ? o : (o.path || o.file || '');
          return '<div class="insight-table-row" data-insight-file="' + escapeHtml(fp) + '">' +
            '<span class="insight-col-full" title="' + escapeHtml(fp) + '">' + escapeHtml(fp) + '</span></div>';
        }).join('') + '</div>'
    );

    html += '</div>';
    $main.innerHTML = html;

    // Section collapse
    $main.querySelectorAll('.insight-section-header').forEach(function (header) {
      header.addEventListener('click', function () {
        var body = header.nextElementSibling;
        if (body) body.classList.toggle('collapsed');
        var chevron = header.querySelector('.insight-section-icon');
        if (chevron) {
          chevron.textContent = body && body.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
        }
      });
    });

    // Click to navigate
    $main.querySelectorAll('[data-insight-file]').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var fp = el.dataset.insightFile;
        if (fileMap[fp]) {
          expandToFile(fp);
          selectFile(fp);
        }
      });
    });
  }

  function insightSection(key, title, count, severity, bodyHtml) {
    var countCls = severity || 'info';
    return '<div class="insight-section">' +
      '<div class="insight-section-header">' +
      '<span class="insight-section-icon">\u25BC</span>' +
      '<span class="insight-section-title">' + title + '</span>' +
      '<span class="insight-section-count ' + countCls + '">' + count + '</span>' +
      '</div>' +
      '<div class="insight-section-body">' + bodyHtml + '</div>' +
      '</div>';
  }

  function updateHash() {
    var parts = ['view=' + state.view];
    if (state.selectedNode) parts.push('file=' + encodeURIComponent(state.selectedNode));
    window.location.hash = parts.join('&');
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = {};
    hash.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
    });
    if (params.view && ['tree', 'treemap', 'routes', 'insights'].indexOf(params.view) !== -1) {
      state.view = params.view;
    }
    if (params.file && fileMap[params.file]) {
      state.selectedNode = params.file;
      expandToFile(params.file);
    }
  }

  document.addEventListener('keydown', function (e) {
    // Escape: close detail / clear search
    if (e.key === 'Escape') {
      if (!$searchResults.classList.contains('hidden')) {
        $searchResults.classList.add('hidden');
        $searchInput.blur();
        return;
      }
      if (state.selectedNode) {
        deselectFile();
        return;
      }
    }

    // / to focus search (when not already focused)
    if (e.key === '/' && document.activeElement !== $searchInput) {
      e.preventDefault();
      $searchInput.focus();
      return;
    }

    // 1-4 for view tabs
    if (document.activeElement === $searchInput) return;
    var views = ['tree', 'treemap', 'routes', 'insights'];
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 4) {
      switchView(views[num - 1]);
    }
  });

  readHash();

  tabButtons.forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === state.view);
  });

  data.files.forEach(function (f) {
    var top = f.path.split('/')[0];
    if (top && top !== f.path) {
      state.expandedDirs.add(top);
    }
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (state.view === 'treemap') renderTreemapView();
    }, 150);
  });

  renderFileTree();
  renderMain();

  if (state.selectedNode && fileMap[state.selectedNode]) {
    $detailPanel.classList.add('open');
    renderDetailPanel(state.selectedNode);
  }

})();
