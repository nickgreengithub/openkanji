/* @ds-bundle: {"format":4,"namespace":"PasteToFileDesignSystem_0eb22b","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"LinkLabel","sourcePath":"components/core/LinkLabel.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"Stat","sourcePath":"components/data/Stat.jsx"},{"name":"StatGrid","sourcePath":"components/data/StatGrid.jsx"},{"name":"PasteArea","sourcePath":"components/forms/PasteArea.jsx"},{"name":"TextInput","sourcePath":"components/forms/TextInput.jsx"}],"sourceHashes":{"components/core/Button.jsx":"5e618c47013e","components/core/Icon.jsx":"c15e5ceb0dbd","components/core/LinkLabel.jsx":"7e46126cef63","components/core/Panel.jsx":"15d2cf99e7f2","components/data/Stat.jsx":"6b2e05a4e4df","components/data/StatGrid.jsx":"b2e0de8971fc","components/forms/PasteArea.jsx":"81dd934d2d16","components/forms/TextInput.jsx":"68e1bd047f63","ui_kits/paste-to-file/ConverterScreen.jsx":"4c178b0c263a","ui_kits/paste-to-file/stats.js":"c6f3c457d8f9"},"inlinedExternals":[],"unexposedExports":[{"name":"byteSize","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"computeStats","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"countCsvColumns","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"detectDelimiter","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"detectSizeFormat","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"formatSize","sourcePath":"ui_kits/paste-to-file/stats.js"},{"name":"isCsvSuited","sourcePath":"ui_kits/paste-to-file/stats.js"}]} */

(() => {

const __ds_ns = (window.PasteToFileDesignSystem_0eb22b = window.PasteToFileDesignSystem_0eb22b || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const PATHS = {
  download: /*#__PURE__*/React.createElement("g", {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v12"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m7 10 5 5 5-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 20h14"
  })),
  github: /*#__PURE__*/React.createElement("path", {
    fill: "currentColor",
    d: "M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.578 9.578 0 0 1 12 6.844a9.58 9.58 0 0 1 2.508.337c1.909-1.294 2.747-1.026 2.747-1.026.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10Z"
  })
};

/** Thin-stroke glyph wrapper. Sized to track its label. */
function Icon({
  name,
  size = "0.95rem",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    style: {
      width: size,
      height: size,
      display: "block",
      flexShrink: 0,
      ...style
    }
  }, rest), PATHS[name] ?? null);
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  height: "var(--control-h)",
  padding: "0 0.9rem",
  border: "1px solid var(--border-emphasis)",
  background: "transparent",
  color: "var(--text-accent)",
  fontFamily: "var(--font-1)",
  fontSize: "var(--text-sm)",
  letterSpacing: "var(--tracking-tight)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  boxShadow: "var(--glow-control)",
  transition: "border-color var(--ease), box-shadow var(--ease), color var(--ease)"
};
const buttonVariants = {
  primary: {},
  ghost: {
    border: "1px solid var(--border-default)",
    boxShadow: "none",
    color: "var(--text-accent-dim)"
  },
  quiet: {
    border: "0",
    boxShadow: "none",
    color: "var(--text-muted)",
    padding: "0 0.4rem"
  }
};

/** The product's only button: square corners, hairline cyan edge, glow on hover. */
function Button({
  variant = "primary",
  icon,
  block = false,
  disabled = false,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const hovered = hover && !disabled ? {
    borderColor: "var(--border-active)",
    boxShadow: variant === "primary" ? "var(--glow-control-hover)" : "none",
    color: "var(--text-accent-hover)"
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...buttonBase,
      ...buttonVariants[variant],
      width: block ? "100%" : undefined,
      opacity: disabled ? 0.35 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
      ...hovered,
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon
  }) : null, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/LinkLabel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Uppercase, wide-tracked micro link. Used for meta/footer navigation. */
function LinkLabel({
  href,
  icon,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", _extends({
    href: href,
    target: "_blank",
    rel: "noreferrer",
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.45rem",
      fontFamily: "var(--font-1)",
      fontSize: "var(--text-xs)",
      letterSpacing: "var(--tracking-wider)",
      textTransform: "uppercase",
      color: hover ? "var(--text-accent)" : "var(--text-accent-dim)",
      textDecoration: "none",
      transition: "color var(--ease)",
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: "1.1rem"
  }) : null, children);
}
Object.assign(__ds_scope, { LinkLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/LinkLabel.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Framed surface: near-black fill, hairline cyan border, faint outer glow. */
function Panel({
  focusable = false,
  focused = false,
  padded = false,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      minHeight: 0,
      background: "var(--surface-panel)",
      border: "1px solid " + (focused ? "var(--border-emphasis)" : "var(--border-default)"),
      borderRadius: "var(--radius)",
      boxShadow: focused && focusable ? "var(--glow-panel-focus)" : "var(--glow-panel)",
      transition: "border-color var(--ease), box-shadow var(--ease)",
      padding: padded ? "var(--space-9)" : 0,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/data/Stat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** One readout cell: glowing cyan value over an uppercase micro label. */
function Stat({
  value,
  label,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      gap: "var(--space-1)",
      padding: "var(--pad-stat)",
      minWidth: 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-1)",
      fontSize: "var(--text-lg)",
      color: "var(--text-accent)",
      textShadow: "var(--glow-text)",
      lineHeight: "var(--leading-tight)"
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-2)",
      fontSize: "var(--text-2xs)",
      letterSpacing: "var(--tracking-wide)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label));
}
Object.assign(__ds_scope, { Stat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Stat.jsx", error: String((e && e.message) || e) }); }

// components/data/StatGrid.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Hairline-ruled readout matrix. Rules are internal plus a single top and bottom
    edge, so it reads as a schematic rather than a card. */
function StatGrid({
  items = [],
  columns = 2,
  style,
  ...rest
}) {
  const lastRowStart = Math.floor((items.length - 1) / columns) * columns;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(" + columns + ", 1fr)",
      borderTop: "1px solid var(--border-default)",
      borderBottom: "1px solid var(--border-default)",
      minHeight: 0,
      ...style
    }
  }, rest), items.map((it, i) => /*#__PURE__*/React.createElement(__ds_scope.Stat, {
    key: it.label + i,
    value: it.value,
    label: it.label,
    style: {
      borderRight: (i + 1) % columns === 0 ? 0 : "1px solid var(--border-default)",
      borderBottom: i >= lastRowStart ? 0 : "1px solid var(--border-default)"
    }
  })));
}
Object.assign(__ds_scope, { StatGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatGrid.jsx", error: String((e && e.message) || e) }); }

// components/forms/PasteArea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Full-height paste surface. The product's primary input — one per screen. */
function PasteArea({
  placeholder = "Paste your content here...",
  value,
  onChange,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    focusable: true,
    focused: focus,
    style: {
      height: "100%",
      ...style
    }
  }, /*#__PURE__*/React.createElement("textarea", _extends({
    spellCheck: false,
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false)
  }, rest, {
    style: {
      width: "100%",
      height: "100%",
      minHeight: 0,
      resize: "none",
      border: 0,
      outline: "none",
      background: "transparent",
      color: "var(--text-body)",
      fontFamily: "var(--font-1)",
      fontWeight: "var(--weight-light)",
      fontSize: "var(--text-base)",
      lineHeight: "var(--leading-relaxed)",
      padding: "var(--pad-editor)",
      display: "block"
    }
  })));
}
Object.assign(__ds_scope, { PasteArea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/PasteArea.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextInput.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Single-line field: transparent fill, hairline cyan border, glow ring on focus. */
function TextInput({
  style,
  onFocus,
  onBlur,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    onFocus: e => {
      setFocus(true);
      if (onFocus) onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      if (onBlur) onBlur(e);
    }
  }, rest, {
    style: {
      width: "100%",
      height: "var(--control-h)",
      border: "1px solid " + (focus ? "var(--border-emphasis)" : "var(--border-default)"),
      borderRadius: "var(--radius)",
      background: "transparent",
      color: "var(--text-body)",
      fontFamily: "var(--font-2)",
      fontWeight: "var(--weight-light)",
      fontSize: "var(--text-sm)",
      padding: "0 var(--pad-control-x)",
      outline: "none",
      boxShadow: focus ? "var(--glow-input-focus)" : "none",
      transition: "border-color var(--ease), box-shadow var(--ease)",
      ...style
    }
  }));
}
Object.assign(__ds_scope, { TextInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextInput.jsx", error: String((e && e.message) || e) }); }

// ui_kits/paste-to-file/ConverterScreen.jsx
try { (() => {
const {
  Button,
  Panel,
  TextInput,
  PasteArea,
  StatGrid,
  LinkLabel
} = window.PasteToFileDesignSystem_0eb22b;
function ConverterScreen() {
  const [text, setText] = React.useState("");
  const [name, setName] = React.useState("my_converted_file");
  const [toast, setToast] = React.useState(null);
  const stats = window.PTFStats.computeStats(text);
  const save = ext => {
    const safe = (name || "my_converted_file").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "my_converted_file";
    setToast(safe + "." + ext);
    clearTimeout(window.__ptfToast);
    window.__ptfToast = setTimeout(() => setToast(null), 1800);
  };
  return /*#__PURE__*/React.createElement("main", {
    className: "shell"
  }, /*#__PURE__*/React.createElement("section", {
    className: "grid"
  }, /*#__PURE__*/React.createElement(PasteArea, {
    value: text,
    onChange: e => setText(e.target.value)
  }), /*#__PURE__*/React.createElement("aside", {
    className: "rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "contents"
  }, /*#__PURE__*/React.createElement(StatGrid, {
    items: stats,
    style: {
      flex: 1
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "filename"
  }, /*#__PURE__*/React.createElement(TextInput, {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "filename",
    "aria-label": "Filename"
  }), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, /*#__PURE__*/React.createElement(Button, {
    block: true,
    icon: "download",
    onClick: () => save("csv")
  }, ".csv"), /*#__PURE__*/React.createElement(Button, {
    block: true,
    icon: "download",
    onClick: () => save("md")
  }, ".md"), /*#__PURE__*/React.createElement(Button, {
    block: true,
    icon: "download",
    onClick: () => save("txt")
  }, ".txt"))))), /*#__PURE__*/React.createElement("footer", {
    className: "bottom"
  }, /*#__PURE__*/React.createElement("span", {
    className: "toast",
    style: {
      opacity: toast ? 1 : 0
    }
  }, toast ? "Downloaded " + toast : ""), /*#__PURE__*/React.createElement(LinkLabel, {
    href: "https://github.com/nickgreengithub/paste-to-file",
    icon: "github"
  }, "GitHub")));
}
Object.assign(window, {
  ConverterScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/paste-to-file/ConverterScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/paste-to-file/stats.js
try { (() => {
// Metric logic lifted from nickgreengithub/paste-to-file index.html.
const formatSize = b => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB";
const byteSize = v => new TextEncoder().encode(v).length;
const delimiterChar = d => d === "tab" ? "\t" : d === "pipe" ? "|" : ",";
const detectDelimiter = text => {
  if (!text) return null;
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.length > 0);
  if (!lines.length) return null;
  const s = lines.slice(0, 20);
  const c = s.reduce((n, l) => n + (l.match(/,/g) || []).length, 0);
  const t = s.reduce((n, l) => n + (l.match(/\t/g) || []).length, 0);
  const p = s.reduce((n, l) => n + (l.match(/\|/g) || []).length, 0);
  const max = Math.max(c, t, p);
  if (max === 0) return null;
  if (t === max) return "tab";
  if (p === max) return "pipe";
  return "comma";
};
const isCsvSuited = (text, delim) => {
  if (!delim || !text.trim()) return false;
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (!lines.length) return false;
  const d = delimiterChar(delim);
  const counts = lines.map(l => l.split(d).length);
  const maxCols = Math.max(...counts);
  if (maxCols < 2) return false;
  return counts.filter(c => c === maxCols).length / counts.length >= 0.8;
};
const escapeCsvField = x => /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
const csvByteSize = (text, delim) => {
  const d = delimiterChar(delim);
  return byteSize(text.split(/\r\n|\n|\r/).filter(l => l.length > 0).map(l => l.split(d).map(escapeCsvField).join(",")).join("\n"));
};
const hasMarkdown = t => !!t.trim() && t.split(/\r\n|\n|\r/).some(l => /^\s*#/.test(l));
const detectSizeFormat = text => {
  if (!text.trim()) return {
    label: "Size",
    bytes: 0
  };
  const delim = detectDelimiter(text);
  if (isCsvSuited(text, delim)) return {
    label: "CSV-Size",
    bytes: csvByteSize(text, delim)
  };
  if (hasMarkdown(text)) return {
    label: "MD-Size",
    bytes: byteSize(text)
  };
  return {
    label: "TXT-Size",
    bytes: byteSize(text)
  };
};
const countCsvColumns = (text, delim) => {
  const d = delimiterChar(delim);
  return text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0).reduce((m, l) => Math.max(m, l.split(d).length), 0);
};
const computeStats = text => {
  const trimmed = text.trim();
  const delim = detectDelimiter(text);
  const csv = isCsvSuited(text, delim);
  const size = detectSizeFormat(text);
  return [{
    value: String(trimmed ? trimmed.split(/\s+/).length : 0),
    label: "Words"
  }, {
    value: String(text.length),
    label: "Characters"
  }, {
    value: String(text === "" ? 0 : text.split(/\r\n|\n|\r/).length),
    label: "Rows"
  }, {
    value: csv ? String(countCsvColumns(text, delim)) : "—",
    label: "Columns"
  }, {
    value: formatSize(size.bytes),
    label: size.label
  }, {
    value: csv ? delim : "—",
    label: "Delimiter"
  }];
};
Object.assign(__ds_scope, { formatSize, byteSize, detectDelimiter, isCsvSuited, detectSizeFormat, countCsvColumns, computeStats });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/paste-to-file/stats.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.LinkLabel = __ds_scope.LinkLabel;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Stat = __ds_scope.Stat;

__ds_ns.StatGrid = __ds_scope.StatGrid;

__ds_ns.PasteArea = __ds_scope.PasteArea;

__ds_ns.TextInput = __ds_scope.TextInput;

})();
