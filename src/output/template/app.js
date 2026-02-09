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
    insightSections: { circular: true, deadExports: true, orphans: true, complexity: true }
  };

  var palette = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff',
    '#f778ba', '#79c0ff', '#56d364', '#e3b341', '#ff7b72',
    '#d2a8ff', '#ff9bce', '#a5d6ff', '#7ee787', '#f0c761'
  ];

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

  function getDirColor(filePath) {
    var top = filePath.split('/')[0] || filePath;
    if (!dirColorMap[top]) {
      dirColorMap[top] = palette[dirColorIndex % palette.length];
      dirColorIndex++;
    }
    return dirColorMap[top];
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
    // Sort: directories first, then files
    var dirs = Object.keys(node.children).sort();
    var files = node.files.slice().sort(function (a, b) {
      return a.path.localeCompare(b.path);
    });

    dirs.forEach(function (dirName) {
      var dirPath = pathPrefix ? pathPrefix + '/' + dirName : dirName;
      var child = node.children[dirName];
      var isExpanded = state.expandedDirs.has(dirPath);

      // Count total files in this subtree
      var count = countFiles(child);

      var item = document.createElement('div');
      item.className = 'tree-item directory';
      item.style.paddingLeft = (depth * 16 + 8) + 'px';
      item.innerHTML =
        '<span class="tree-chevron ' + (isExpanded ? 'open' : '') + '">\u25B6</span>' +
        '<span class="tree-icon ' + (isExpanded ? 'dir-open' : 'dir') + '">' + (isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1') + '</span>' +
        '<span class="tree-label">' + escapeHtml(dirName) + '</span>' +
        '<span class="tree-badge">' + count + '</span>';

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

      var item = document.createElement('div');
      item.className = 'tree-item' + (state.selectedNode === f.path ? ' active' : '');
      item.style.paddingLeft = (depth * 16 + 8) + 'px';
      item.innerHTML =
        '<span class="tree-indent"></span>' +
        '<span class="tree-icon ' + iconInfo.cls + '">' + iconInfo.icon + '</span>' +
        '<span class="tree-label">' + escapeHtml(fileName) + '</span>' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + cxColor + ';flex-shrink:0;margin-left:auto;margin-right:4px;"></span>' +
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

    // Stats
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

    // Bind navigation clicks
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
    // Try with common extensions
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
      case 'graph': renderGraphView(); break;
      case 'tree': renderTreeView(); break;
      case 'routes': renderRoutesView(); break;
      case 'insights': renderInsightsView(); break;
    }
  }

  var simulation = null;

  var LAYER_PALETTES = {
    routes: ['#58a6ff','#79c0ff','#388bfd','#6cb6ff','#4493f8','#a5d6ff','#539bf5','#82b1ff'],
    modules: ['#f78166','#ffa657','#d29922','#e3b341','#db6d28','#f0883e','#d4a72c','#e09b4f'],
    core: ['#7ee787','#56d364','#3fb950','#aff5b4','#46954a','#8ddb8c','#57ab5a','#6bc46d']
  };

  function generateModuleColor(layer, index) {
    var pal = LAYER_PALETTES[layer] || LAYER_PALETTES.core;
    return pal[index % pal.length];
  }

  var LAYER_COLORS = {
    routes: '#58a6ff',
    modules: '#f78166',
    core: '#7ee787'
  };

  var LAYER_LABELS = {
    routes: 'Routes & Endpoints',
    modules: 'Business Modules',
    core: 'Core Libraries'
  };

  var LAYER_ICONS = {
    routes: '\u2192',
    modules: '\u25A0',
    core: '\u2699'
  };

  var archExpandedModules = {};
  var archCollapsedLayers = {};
  var archHoveredModule = null;
  var archModuleColorMap = {};

  var ORG_DIRS = { client:1, server:1, components:1, stores:1, services:1, repositories:1, middleware:1, utils:1, types:1, assets:1, styles:1, config:1 };

  function getModuleId(filePath) {
    var parts = filePath.split('/');
    if (parts[0] === 'src') parts = parts.slice(1);

    if (parts[0] === 'routes') {
      if (!parts[1] || parts[1].startsWith('+')) return 'routes/(root)';
      if (parts[1] === 'api') {
        if (parts[2] === 'modules' && parts[3]) return 'routes/api/' + parts[3];
        if (!parts[2] || parts[2].startsWith('+')) return 'routes/api';
        return 'routes/api/' + parts[2];
      }
      if (parts[2] === 'modules' && parts[3]) return 'routes/' + parts[1] + '/' + parts[3];
      return 'routes/' + parts[1];
    }

    if (parts[0] === 'lib' && parts[1] === 'modules' && parts[2]) {
      if (parts[3] && /^[a-z]/.test(parts[3]) && parts[3].indexOf('.') === -1 && !ORG_DIRS[parts[3]]) {
        return 'modules/' + parts[2] + '/' + parts[3];
      }
      return 'modules/' + parts[2];
    }

    if (parts[0] === 'lib' && parts[1]) {
      return 'lib/' + parts[1];
    }

    return parts[0] || 'root';
  }

  function getLayer(moduleId) {
    if (moduleId.startsWith('routes/')) return 'routes';
    if (moduleId.startsWith('modules/')) return 'modules';
    return 'core';
  }

  var SIDE_CONFIG = {
    client: { label: 'Client', color: '#58a6ff', icon: '\u25CB' },
    server: { label: 'Server', color: '#f78166', icon: '\u25CF' },
    shared: { label: 'Shared', color: '#7ee787', icon: '\u25D0' }
  };

  function getFileSide(filePath) {
    var p = filePath.toLowerCase();
    if (p.startsWith('src/')) p = p.substring(4);

    if (p.includes('.server.') || p.includes('+server.')) return 'server';
    if (p.match(/\/(server|repositories|services|middleware|db|cache)\//)) return 'server';
    if (p.includes('.client.')) return 'client';
    if (p.includes('/components/') || p.includes('/stores/') || p.includes('/composables/')) return 'client';
    if (p.includes('/i18n/') || p.includes('/styles/') || p.includes('/assets/')) return 'client';
    if (p.endsWith('.svelte')) return 'client';
    if (p.match(/routes\/api\//)) return 'server';
    if (p.match(/routes\//) && !p.includes('+server.')) return 'client';
    if (p.includes('/shared/') || p.includes('/config/') || p.includes('/utils/') || p.includes('/types/')) return 'shared';
    return 'shared';
  }

  function getModuleSide(files) {
    var client = 0, server = 0, shared = 0;
    files.forEach(function (fp) {
      var s = getFileSide(fp);
      if (s === 'client') client++;
      else if (s === 'server') server++;
      else shared++;
    });
    var total = client + server + shared;
    if (client > 0 && server > 0) return { side: 'fullstack', client: client, server: server, shared: shared, total: total };
    if (client > server && client > shared) return { side: 'client', client: client, server: server, shared: shared, total: total };
    if (server > client && server > shared) return { side: 'server', client: client, server: server, shared: shared, total: total };
    return { side: 'shared', client: client, server: server, shared: shared, total: total };
  }

  function buildArchData() {
    var moduleMap = {};

    data.files.forEach(function (f) {
      var modId = getModuleId(f.path);
      if (!moduleMap[modId]) {
        moduleMap[modId] = {
          id: modId,
          files: [],
          fileCount: 0,
          functionCount: 0,
          lineCount: 0,
          totalComplexity: 0,
          complexityCount: 0
        };
      }
      var mod = moduleMap[modId];
      mod.files.push(f.path);
      mod.fileCount++;
      mod.functionCount += (f.functions ? f.functions.length : 0);
      mod.lineCount += (f.lines || 0);
      var cx = fileComplexity(f);
      if (cx > 0) {
        mod.totalComplexity += cx;
        mod.complexityCount++;
      }
    });

    // compute side info for each module
    var moduleIds = Object.keys(moduleMap);
    moduleIds.forEach(function (modId) {
      moduleMap[modId].sideInfo = getModuleSide(moduleMap[modId].files);
    });

    archModuleColorMap = {};

    var crossEdges = {};
    var allEdges = (data.graph && data.graph.edges) || [];
    allEdges.forEach(function (e) {
      var srcMod = getModuleId(e.source);
      var tgtMod = getModuleId(e.target);
      if (srcMod !== tgtMod) {
        var key = srcMod + '->' + tgtMod;
        crossEdges[key] = (crossEdges[key] || 0) + 1;
      }
    });

    var moduleEdges = [];
    Object.keys(crossEdges).forEach(function (key) {
      var parts = key.split('->');
      moduleEdges.push({ source: parts[0], target: parts[1], weight: crossEdges[key] });
    });

    var topDeps = {};
    moduleIds.forEach(function (modId) {
      var outgoing = {};
      var incoming = {};
      moduleEdges.forEach(function (e) {
        if (e.source === modId) outgoing[e.target] = (outgoing[e.target] || 0) + e.weight;
        if (e.target === modId) incoming[e.source] = (incoming[e.source] || 0) + e.weight;
      });
      var outArr = Object.keys(outgoing).map(function (k) { return { id: k, count: outgoing[k] }; });
      var inArr = Object.keys(incoming).map(function (k) { return { id: k, count: incoming[k] }; });
      outArr.sort(function (a, b) { return b.count - a.count; });
      inArr.sort(function (a, b) { return b.count - a.count; });
      topDeps[modId] = { outgoing: outArr.slice(0, 5), incoming: inArr.slice(0, 5) };
    });

    var layers = { routes: [], modules: [], core: [] };
    moduleIds.forEach(function (modId) {
      var layer = getLayer(modId);
      layers[layer].push(moduleMap[modId]);
    });

    // within each layer, group by side then sort by fileCount
    Object.keys(layers).forEach(function (layer) {
      layers[layer].sort(function (a, b) {
        var sideOrder = { server: 0, client: 1, fullstack: 2, shared: 3 };
        var sa = sideOrder[a.sideInfo.side] || 3;
        var sb = sideOrder[b.sideInfo.side] || 3;
        if (sa !== sb) return sa - sb;
        return b.fileCount - a.fileCount;
      });
    });

    // assign colors per-layer so each layer has its own distinct hue family
    ['routes', 'modules', 'core'].forEach(function (lk) {
      layers[lk].forEach(function (mod, idx) {
        archModuleColorMap[mod.id] = generateModuleColor(lk, idx);
      });
    });

    return {
      modules: moduleMap,
      moduleIds: moduleIds,
      moduleEdges: moduleEdges,
      topDeps: topDeps,
      layers: layers
    };
  }

  function renderGraphView() {
    renderGraphLevel();
  }

  function renderGraphLevel() {
    var ad = buildArchData();

    if (!data.files || data.files.length === 0) {
      $main.innerHTML =
        '<div class="empty-state"><div class="empty-state-icon">\u25C7</div>' +
        '<div class="empty-state-title">No file data</div>' +
        '<div class="empty-state-desc">No files were found to visualize.</div></div>';
      return;
    }

    var totalFiles = data.files.length;
    var html = '<div class="arch-map" id="arch-map">';

    html += '<div class="arch-toolbar">';
    html += '<input class="arch-search" id="arch-search" placeholder="Filter modules..." type="text" />';
    html += '<span class="arch-file-total">' + totalFiles + ' files</span>';
    html += '</div>';

    var layerOrder = ['routes', 'modules', 'core'];
    layerOrder.forEach(function (layerKey) {
      var mods = ad.layers[layerKey];
      if (mods.length === 0) return;

      var layerFileCount = 0;
      var layerClient = 0, layerServer = 0, layerShared = 0;
      mods.forEach(function (m) {
        layerFileCount += m.fileCount;
        layerClient += m.sideInfo.client;
        layerServer += m.sideInfo.server;
        layerShared += m.sideInfo.shared;
      });

      var isCollapsed = !!archCollapsedLayers[layerKey];
      html += '<div class="arch-layer' + (isCollapsed ? ' arch-layer-collapsed' : '') + '" data-layer="' + layerKey + '">';
      html += '<div class="arch-layer-header" data-layer-toggle="' + layerKey + '">';
      html += '<span class="arch-layer-chevron">' + (isCollapsed ? '\u25B6' : '\u25BC') + '</span>';
      html += '<span class="arch-layer-icon">' + LAYER_ICONS[layerKey] + '</span>';
      html += '<span class="arch-layer-title">' + LAYER_LABELS[layerKey] + '</span>';
      html += '<span class="arch-layer-count">' + mods.length + ' modules \u00B7 ' + layerFileCount + ' files</span>';
      html += '<span class="arch-layer-sides">';
      if (layerServer > 0) html += '<span class="arch-side-pill arch-side-pill-server">' + layerServer + ' server</span>';
      if (layerClient > 0) html += '<span class="arch-side-pill arch-side-pill-client">' + layerClient + ' client</span>';
      if (layerShared > 0) html += '<span class="arch-side-pill arch-side-pill-shared">' + layerShared + ' shared</span>';
      html += '</span>';
      html += '</div>';
      html += '<div class="arch-layer-cards" style="' + (isCollapsed ? 'display:none' : '') + '">';

      mods.forEach(function (mod) {
        var color = archModuleColorMap[mod.id];
        var idParts = mod.id.split('/');
        var label;
        if (idParts.length >= 3) {
          label = idParts.slice(1).join('/');
        } else {
          label = idParts.pop() || mod.id;
        }
        var avgCx = mod.complexityCount > 0 ? Math.round(mod.totalComplexity / mod.complexityCount) : 0;
        var cxColor = avgCx < 10 ? '#3fb950' : avgCx < 20 ? '#d29922' : '#f85149';
        var isExpanded = !!archExpandedModules[mod.id];
        var deps = ad.topDeps[mod.id];
        var depsText = '';
        if (deps && deps.outgoing.length > 0) {
          depsText = deps.outgoing.slice(0, 3).map(function (dep) {
            return dep.id.split('/').pop();
          }).join(', ');
        }

        var si = mod.sideInfo;
        var sideLabel = si.side === 'fullstack' ? 'Full Stack' : SIDE_CONFIG[si.side] ? SIDE_CONFIG[si.side].label : si.side;
        var sideCls = si.side;

        html += '<div class="arch-card' + (isExpanded ? ' expanded' : '') + ' arch-side-' + sideCls + '" data-module="' + escapeHtml(mod.id) + '" style="border-left-color:' + color + '">';
        html += '<div class="arch-card-header">';
        html += '<span class="arch-card-name">' + escapeHtml(label) + '</span>';
        html += '<span class="arch-card-side arch-side-badge-' + sideCls + '">' + escapeHtml(sideLabel) + '</span>';
        html += '<span class="arch-card-complexity" style="background:' + cxColor + '" title="Avg complexity: ' + avgCx + '"></span>';
        html += '</div>';
        html += '<div class="arch-card-stats">';
        html += '<span>' + mod.fileCount + ' files</span>';
        html += '<span class="arch-card-dot">\u00B7</span>';
        html += '<span>' + mod.functionCount + ' fn</span>';
        html += '</div>';
        // client/server split bar
        if (si.client > 0 || si.server > 0) {
          var cPct = Math.round((si.client / si.total) * 100);
          var sPct = Math.round((si.server / si.total) * 100);
          var shPct = 100 - cPct - sPct;
          html += '<div class="arch-card-split" title="Client: ' + si.client + ' / Server: ' + si.server + ' / Shared: ' + si.shared + '">';
          if (sPct > 0) html += '<span class="split-server" style="width:' + sPct + '%"></span>';
          if (cPct > 0) html += '<span class="split-client" style="width:' + cPct + '%"></span>';
          if (shPct > 0) html += '<span class="split-shared" style="width:' + shPct + '%"></span>';
          html += '</div>';
        }
        if (depsText) {
          html += '<div class="arch-card-deps">\u2192 ' + escapeHtml(depsText) + '</div>';
        }

        if (isExpanded) {
          html += '<div class="arch-card-files">';
          var sortedFiles = mod.files.slice().sort(function (a, b) {
            var fa = fileMap[a], fb = fileMap[b];
            var la = fa ? fa.lines : 0, lb = fb ? fb.lines : 0;
            return lb - la;
          });
          sortedFiles.forEach(function (fp) {
            var f = fileMap[fp];
            var fname = fp.split('/').pop();
            var lines = f ? f.lines : 0;
            var fnCount = f ? f.functions.length : 0;
            var cx = fileComplexity(f || {});
            var fCxColor = cx < 10 ? '#3fb950' : cx < 20 ? '#d29922' : '#f85149';
            var fSide = getFileSide(fp);
            html += '<div class="arch-file-item" data-file="' + escapeHtml(fp) + '">';
            html += '<span class="arch-file-cx" style="background:' + fCxColor + '"></span>';
            html += '<span class="arch-file-name">' + escapeHtml(fname) + '</span>';
            html += '<span class="arch-file-side arch-side-badge-' + fSide + '">' + SIDE_CONFIG[fSide].label + '</span>';
            html += '<span class="arch-file-meta">' + lines + 'L / ' + fnCount + 'fn</span>';
            html += '</div>';
          });
          html += '</div>';
        }

        html += '</div>';
      });

      html += '</div></div>';
    });

    html += '<svg class="arch-arrows" id="arch-arrows"></svg>';
    html += '</div>';

    $main.innerHTML = html;

    var archMap = document.getElementById('arch-map');
    var svgArrows = document.getElementById('arch-arrows');

    var cards = archMap.querySelectorAll('.arch-card');
    cards.forEach(function (card) {
      var modId = card.dataset.module;

      card.addEventListener('click', function (e) {
        if (e.target.closest('.arch-file-item')) return;
        archExpandedModules[modId] = !archExpandedModules[modId];
        toggleCardExpand(card, modId, ad);
      });

      card.addEventListener('mouseenter', function () {
        archHoveredModule = modId;
        drawArrows(ad, archMap, svgArrows, modId);
        cards.forEach(function (c) {
          if (c.dataset.module !== modId) {
            c.classList.add('arch-card-dimmed');
          }
        });
        highlightConnectedCards(ad, modId, cards);
      });

      card.addEventListener('mouseleave', function () {
        archHoveredModule = null;
        clearArrows(svgArrows);
        cards.forEach(function (c) {
          c.classList.remove('arch-card-dimmed');
          c.classList.remove('arch-card-connected');
        });
        drawIdleArrows(ad, archMap, svgArrows);
      });
    });

    var fileItems = archMap.querySelectorAll('.arch-file-item');
    fileItems.forEach(function (item) {
      var fp = item.dataset.file;
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        selectFile(fp);
        expandToFile(fp);
      });
      item.addEventListener('mouseenter', function (ev) {
        showFileDependencyTooltip(ev, fp);
      });
      item.addEventListener('mousemove', moveTooltip);
      item.addEventListener('mouseleave', hideTooltip);
    });

    // Layer collapse/expand
    archMap.querySelectorAll('[data-layer-toggle]').forEach(function (header) {
      header.addEventListener('click', function () {
        var lk = header.dataset.layerToggle;
        archCollapsedLayers[lk] = !archCollapsedLayers[lk];
        var layer = header.closest('.arch-layer');
        var cardsDiv = layer.querySelector('.arch-layer-cards');
        var chevron = header.querySelector('.arch-layer-chevron');
        if (archCollapsedLayers[lk]) {
          layer.classList.add('arch-layer-collapsed');
          cardsDiv.style.display = 'none';
          chevron.textContent = '\u25B6';
        } else {
          layer.classList.remove('arch-layer-collapsed');
          cardsDiv.style.display = '';
          chevron.textContent = '\u25BC';
        }
        clearArrows(svgArrows);
        if (!archCollapsedLayers[lk]) drawIdleArrows(ad, archMap, svgArrows);
      });
    });

    // Search filter
    var searchInput = document.getElementById('arch-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var q = searchInput.value.toLowerCase().trim();
        cards.forEach(function (card) {
          var modId = card.dataset.module;
          if (!q || modId.toLowerCase().indexOf(q) !== -1) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      });
    }

    drawIdleArrows(ad, archMap, svgArrows);
  }

  function toggleCardExpand(card, modId, ad) {
    var isExpanded = archExpandedModules[modId];
    var existingFiles = card.querySelector('.arch-card-files');

    if (!isExpanded) {
      // collapse: remove file list
      if (existingFiles) existingFiles.remove();
      card.classList.remove('expanded');
    } else {
      // expand: add file list
      card.classList.add('expanded');
      var mod = ad.modules[modId];
      if (!mod) return;

      var filesDiv = document.createElement('div');
      filesDiv.className = 'arch-card-files';

      var sortedFiles = mod.files.slice().sort(function (a, b) {
        var fa = fileMap[a], fb = fileMap[b];
        var la = fa ? fa.lines : 0, lb = fb ? fb.lines : 0;
        return lb - la;
      });

      sortedFiles.forEach(function (fp) {
        var f = fileMap[fp];
        var fname = fp.split('/').pop();
        var lines = f ? f.lines : 0;
        var fnCount = f ? f.functions.length : 0;
        var cx = fileComplexity(f || {});
        var fCxColor = cx < 10 ? '#3fb950' : cx < 20 ? '#d29922' : '#f85149';
        var fSide = getFileSide(fp);
        var item = document.createElement('div');
        item.className = 'arch-file-item';
        item.dataset.file = fp;
        item.innerHTML = '<span class="arch-file-cx" style="background:' + fCxColor + '"></span>' +
          '<span class="arch-file-name">' + escapeHtml(fname) + '</span>' +
          '<span class="arch-file-side arch-side-badge-' + fSide + '">' + SIDE_CONFIG[fSide].label + '</span>' +
          '<span class="arch-file-meta">' + lines + 'L / ' + fnCount + 'fn</span>';

        item.addEventListener('click', function (e) {
          e.stopPropagation();
          selectFile(fp);
          expandToFile(fp);
        });

        // hover: show dependency info
        item.addEventListener('mouseenter', function (ev) {
          showFileDependencyTooltip(ev, fp);
        });
        item.addEventListener('mousemove', moveTooltip);
        item.addEventListener('mouseleave', hideTooltip);

        filesDiv.appendChild(item);
      });

      card.appendChild(filesDiv);
    }

    // redraw arrows since card sizes changed
    var archMap = document.getElementById('arch-map');
    var svgArrows = document.getElementById('arch-arrows');
    if (archMap && svgArrows) {
      svgArrows.setAttribute('height', archMap.scrollHeight);
      if (archHoveredModule) {
        drawArrows(ad, archMap, svgArrows, archHoveredModule);
      } else {
        drawIdleArrows(ad, archMap, svgArrows);
      }
    }
  }

  function showFileDependencyTooltip(ev, filePath) {
    var f = fileMap[filePath];
    if (!f) return;

    var usedBy = usedByMap[filePath] || [];
    var imps = (f.imports || []).filter(function (i) { return !i.source.startsWith('$app') && !i.source.startsWith('$env'); });
    var fns = f.functions || [];
    var cx = fileComplexity(f);

    var html = '<div style="max-width:320px">';
    html += '<div style="font-weight:600;margin-bottom:6px;font-size:12px;color:var(--accent);word-break:break-all">' + escapeHtml(filePath) + '</div>';
    html += '<div style="display:flex;gap:12px;margin-bottom:6px;font-size:11px;color:var(--text-secondary)">';
    html += '<span>' + f.lines + ' lines</span>';
    html += '<span>' + fns.length + ' fn</span>';
    html += '<span>cx: ' + cx + '</span>';
    html += '</div>';

    if (imps.length > 0) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;font-weight:600">IMPORTS (' + imps.length + ')</div>';
      html += '<div style="max-height:150px;overflow-y:auto">';
      imps.forEach(function (i) {
        var name = i.source.split('/').pop();
        html += '<div style="font-size:11px;color:var(--text-secondary);padding:1px 0">\u2190 ' + escapeHtml(name) + '</div>';
      });
      html += '</div>';
    }

    if (usedBy.length > 0) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;font-weight:600">USED BY (' + usedBy.length + ')</div>';
      html += '<div style="max-height:150px;overflow-y:auto">';
      usedBy.forEach(function (p) {
        var name = p.split('/').pop();
        html += '<div style="font-size:11px;color:var(--accent-secondary);padding:1px 0">\u2192 ' + escapeHtml(name) + '</div>';
      });
      html += '</div>';
    }

    if (fns.length > 0) {
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;font-weight:600">FUNCTIONS (' + fns.length + ')</div>';
      html += '<div style="max-height:150px;overflow-y:auto">';
      fns.forEach(function (fn) {
        html += '<div style="font-size:11px;color:var(--text-secondary);padding:1px 0;font-family:var(--font-mono)">' + escapeHtml(fn.name) + '()</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    showTooltip(ev, html);
  }

  function highlightConnectedCards(ad, modId, cards) {
    var connected = new Set();
    ad.moduleEdges.forEach(function (e) {
      if (e.source === modId) connected.add(e.target);
      if (e.target === modId) connected.add(e.source);
    });
    cards.forEach(function (c) {
      if (connected.has(c.dataset.module)) {
        c.classList.remove('arch-card-dimmed');
        c.classList.add('arch-card-connected');
      }
    });
  }

  function getCardCenter(card, container) {
    var cr = card.getBoundingClientRect();
    var mr = container.getBoundingClientRect();
    return {
      x: cr.left - mr.left + cr.width / 2 + container.scrollLeft,
      y: cr.top - mr.top + cr.height / 2 + container.scrollTop
    };
  }

  function getCardEdgePoint(card, container, targetX, targetY) {
    var cr = card.getBoundingClientRect();
    var mr = container.getBoundingClientRect();
    var cx = cr.left - mr.left + cr.width / 2 + container.scrollLeft;
    var cy = cr.top - mr.top + cr.height / 2 + container.scrollTop;
    var hw = cr.width / 2;
    var hh = cr.height / 2;
    var dx = targetX - cx;
    var dy = targetY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    var scale;
    if (absDx / hw > absDy / hh) {
      scale = hw / absDx;
    } else {
      scale = hh / absDy;
    }
    return {
      x: cx + dx * scale,
      y: cy + dy * scale
    };
  }

  function drawArrows(ad, container, svg, hoveredModId) {
    clearArrows(svg);
    var mapRect = container.getBoundingClientRect();
    svg.setAttribute('width', container.scrollWidth);
    svg.setAttribute('height', container.scrollHeight);

    var cardElements = {};
    container.querySelectorAll('.arch-card').forEach(function (c) {
      cardElements[c.dataset.module] = c;
    });

    ad.moduleEdges.forEach(function (e) {
      if (e.source !== hoveredModId && e.target !== hoveredModId) return;
      var srcCard = cardElements[e.source];
      var tgtCard = cardElements[e.target];
      if (!srcCard || !tgtCard) return;

      var srcCenter = getCardCenter(srcCard, container);
      var tgtCenter = getCardCenter(tgtCard, container);
      var srcPoint = getCardEdgePoint(srcCard, container, tgtCenter.x, tgtCenter.y);
      var tgtPoint = getCardEdgePoint(tgtCard, container, srcCenter.x, srcCenter.y);

      var isOutgoing = e.source === hoveredModId;
      var color = isOutgoing ? archModuleColorMap[e.source] : 'rgba(139,148,158,0.6)';
      var thickness = Math.max(1, Math.min(4, Math.ceil(e.weight / 10)));

      var midX = (srcPoint.x + tgtPoint.x) / 2;
      var midY = (srcPoint.y + tgtPoint.y) / 2;
      var dy = tgtPoint.y - srcPoint.y;
      var cpOffset = Math.min(Math.abs(dy) * 0.3, 60);
      if (Math.abs(dy) < 20) cpOffset = 30;
      var cpX = midX + (srcPoint.x < tgtPoint.x ? -cpOffset : cpOffset);

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      var d = 'M' + srcPoint.x + ',' + srcPoint.y +
        ' Q' + cpX + ',' + midY + ' ' + tgtPoint.x + ',' + tgtPoint.y;
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', thickness);
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.7');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);

      var angle = Math.atan2(tgtPoint.y - midY, tgtPoint.x - cpX);
      var arrowSize = 6 + thickness;
      var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      var ax = tgtPoint.x;
      var ay = tgtPoint.y;
      var p1x = ax - arrowSize * Math.cos(angle - 0.4);
      var p1y = ay - arrowSize * Math.sin(angle - 0.4);
      var p2x = ax - arrowSize * Math.cos(angle + 0.4);
      var p2y = ay - arrowSize * Math.sin(angle + 0.4);
      arrow.setAttribute('points', ax + ',' + ay + ' ' + p1x + ',' + p1y + ' ' + p2x + ',' + p2y);
      arrow.setAttribute('fill', color);
      arrow.setAttribute('opacity', '0.8');
      svg.appendChild(arrow);

      var weightLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      weightLabel.setAttribute('x', midX);
      weightLabel.setAttribute('y', midY - 6);
      weightLabel.setAttribute('text-anchor', 'middle');
      weightLabel.setAttribute('fill', 'var(--text-muted)');
      weightLabel.setAttribute('font-size', '10');
      weightLabel.setAttribute('font-family', 'var(--font-mono)');
      weightLabel.textContent = e.weight;
      svg.appendChild(weightLabel);
    });
  }

  function drawIdleArrows(ad, container, svg) {
    clearArrows(svg);
    var mapRect = container.getBoundingClientRect();
    svg.setAttribute('width', container.scrollWidth);
    svg.setAttribute('height', container.scrollHeight);

    var cardElements = {};
    container.querySelectorAll('.arch-card').forEach(function (c) {
      cardElements[c.dataset.module] = c;
    });

    var sorted = ad.moduleEdges.slice().sort(function (a, b) { return b.weight - a.weight; });
    var topEdges = sorted.slice(0, 10);

    topEdges.forEach(function (e) {
      var srcCard = cardElements[e.source];
      var tgtCard = cardElements[e.target];
      if (!srcCard || !tgtCard) return;

      var srcCenter = getCardCenter(srcCard, container);
      var tgtCenter = getCardCenter(tgtCard, container);
      var srcPoint = getCardEdgePoint(srcCard, container, tgtCenter.x, tgtCenter.y);
      var tgtPoint = getCardEdgePoint(tgtCard, container, srcCenter.x, srcCenter.y);

      var midX = (srcPoint.x + tgtPoint.x) / 2;
      var midY = (srcPoint.y + tgtPoint.y) / 2;
      var dy = tgtPoint.y - srcPoint.y;
      var cpOffset = Math.min(Math.abs(dy) * 0.3, 60);
      if (Math.abs(dy) < 20) cpOffset = 30;
      var cpX = midX + (srcPoint.x < tgtPoint.x ? -cpOffset : cpOffset);

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      var d = 'M' + srcPoint.x + ',' + srcPoint.y +
        ' Q' + cpX + ',' + midY + ' ' + tgtPoint.x + ',' + tgtPoint.y;
      path.setAttribute('d', d);
      path.setAttribute('stroke', 'var(--border)');
      path.setAttribute('stroke-width', '1');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.3');
      path.setAttribute('stroke-dasharray', '6,4');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    });
  }

  function clearArrows(svg) {
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  }

  function highlightGraphNode(filePath) {
    var archMap = document.getElementById('arch-map');
    if (!archMap) return;
    archMap.querySelectorAll('.arch-file-item').forEach(function (item) {
      item.classList.toggle('arch-file-active', item.dataset.file === filePath);
    });
    if (filePath) {
      var modId = getModuleId(filePath);
      if (!archExpandedModules[modId]) {
        archExpandedModules[modId] = true;
        renderGraphLevel();
      }
    }
  }

  function clearGraphHighlight() {
    var archMap = document.getElementById('arch-map');
    if (!archMap) return;
    archMap.querySelectorAll('.arch-file-item.arch-file-active').forEach(function (item) {
      item.classList.remove('arch-file-active');
    });
  }

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
      var count = countFiles(child);
      var pl = depth * 20 + 12;

      html += '<div class="tree-item directory" style="padding-left:' + pl + 'px" data-tree-dir="' + escapeHtml(dirPath) + '">' +
        '<span class="tree-chevron ' + (isExpanded ? 'open' : '') + '">\u25B6</span>' +
        '<span class="tree-icon dir">\uD83D\uDCC1</span>' +
        '<span class="tree-label">' + escapeHtml(dirName) + '</span>' +
        '<span class="tree-badge">' + count + '</span></div>';

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
      var pl = depth * 20 + 12;

      html += '<div class="tree-item" style="padding-left:' + pl + 'px" data-tree-file="' + escapeHtml(f.path) + '">' +
        '<span class="tree-indent"></span>' +
        '<span class="tree-icon ' + iconInfo.cls + '">' + iconInfo.icon + '</span>' +
        '<span class="tree-label">' + escapeHtml(fileName) + '</span>' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + cxColor + ';display:inline-block;margin-left:auto;margin-right:8px;flex-shrink:0"></span>' +
        '<span class="tree-badge">' + f.lines + ' lines</span></div>';
    });

    return html;
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
        html += '<span class="routes-method-count badge-' + m.toLowerCase() + '">' + m + ' <strong>' + methodCounts[m] + '</strong></span>';
      }
    });
    // any other methods
    Object.keys(methodCounts).forEach(function (m) {
      if (methodOrder.indexOf(m) === -1) {
        html += '<span class="routes-method-count">' + m + ' <strong>' + methodCounts[m] + '</strong></span>';
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
        var methodBadges = methods.map(function (m) {
          return '<span class="badge badge-' + m.toLowerCase() + '">' + m + '</span>';
        }).join(' ');

        if (methods.length === 0 && r.type === 'page') {
          methodBadges = '<span class="badge badge-get">GET</span>';
        }

        var typeBadge = '<span class="badge badge-' + r.type + '">' + r.type + '</span>';

        html += '<div class="route-row" data-route-file="' + escapeHtml(r.file) + '">' +
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

    var html = '<div class="insights-view">';

    // Summary bar
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
    html += '<div class="insight-summary-item">' +
      '<span class="insight-summary-val">' + topComplex.length + '</span>' +
      '<span class="insight-summary-lbl">Hotspots</span></div>';
    html += '</div>';

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
    if (params.view && ['graph', 'tree', 'routes', 'insights'].indexOf(params.view) !== -1) {
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
    var views = ['graph', 'tree', 'routes', 'insights'];
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 4) {
      switchView(views[num - 1]);
    }
  });

  window.addEventListener('resize', debounce(function () {
    if (state.view === 'graph') renderGraphLevel();
  }, 300));

  readHash();

  // Set active tab
  tabButtons.forEach(function (b) {
    b.classList.toggle('active', b.dataset.view === state.view);
  });

  // Expand top-level directories by default
  data.files.forEach(function (f) {
    var top = f.path.split('/')[0];
    if (top && top !== f.path) {
      state.expandedDirs.add(top);
    }
  });

  renderFileTree();
  renderMain();

  // If a file was selected from hash, show detail
  if (state.selectedNode && fileMap[state.selectedNode]) {
    $detailPanel.classList.add('open');
    renderDetailPanel(state.selectedNode);
  }

})();
