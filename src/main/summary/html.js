const css = `
@import url(https://fonts.googleapis.com/css?family=Roboto:400,500,700,300,100);

body {
  background-color: #3e94ec;
  font-family: "Roboto", helvetica, arial, sans-serif;
  font-size: 16px;
  font-weight: 400;
  text-rendering: optimizeLegibility;
}

div.table-title {
   display: block;
  margin: auto;
  max-width: 600px;
  padding:5px;
  width: 100%;
}

.table-title h3 {
   color: #fafafa;
   font-size: 20px;
   font-weight: 400;
   font-style:normal;
   font-family: "Roboto", helvetica, arial, sans-serif;
   text-transform:uppercase;
}

h3 {
  text-align:center;
  margin: 24px 0px 8px 0px;
}

/*** Table Styles **/

.table-fill {
  background: white;
  border-radius:3px;
  border-collapse: collapse;
  height: 320px;
  margin: auto;
  max-width: 600px;
  padding:5px;
  width: 100%;
  box-shadow: 0 5px 10px rgba(0, 0, 0, 0.1);
  animation: float 5s infinite;
}
 
th {
  color:#D5DDE5;;
  background:#1b1e24;
  border-bottom:4px solid #9ea7af;
  border-right: 1px solid #343a45;
  font-size: 14px;
  font-weight: 100;
  padding: 14px;
  text-align: center;
  vertical-align:middle;
}

th:first-child {
  border-top-left-radius:3px;
}
 
th:last-child {
  border-top-right-radius:3px;
  border-right:none;
}
  
tr {
  border-top: 1px solid #C1C3D1;
  border-bottom-: 1px solid #C1C3D1;
  color: #555;
  font-size:16px;
  font-weight:normal;
}

tr:hover td {
  background:#4E5066;
  color:#FFFFFF;
}

td.best {
  background-color: #6f6 !important;
}

td.attribute {
  color: #444;
  font-weight: bold;
}

th.column-title {
  font-weight: bold;
}

td.worst {
  background-color: #f66 !important;
}

tr:hover td.best,
tr:hover td.worst {
  color: #000;
}

tr:hover td.best {
  background-color: #0f0 !important;
}
tr:hover td.worst {
  background-color: #f00 !important;
}

tr:first-child {
  border-top:none;
}

tr:last-child {
  border-bottom:none;
}

tr:nth-child(odd) td {
  background:#EBEBEB;
}

tr:nth-child(odd):hover td {
  background:#4E5066;
}

tr:last-child td:first-child {
  border-bottom-left-radius:3px;
}

tr:last-child td:last-child {
  border-bottom-right-radius:3px;
}

td {
  background:#FFFFFF;
  padding:12px;
  text-align: right;
  vertical-align:middle;
  font-weight:300;
  font-size:14px;
  border-right: 1px solid #C1C3D1;
}

td:last-child {
  border-right: 0px;
}

td:first-child {
  text-align: left;
}

th.text-left {
  text-align: right;
}

th.text-center {
  text-align: center;
}

th.text-right {
  text-align: right;
}

td.text-left {
  text-align: left;
}

td.text-center {
  text-align: center;
}

td.text-right {
  text-align: right;
}`;

function exportHTML(html, title) {
  return `
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta name="viewport" content="initial-scale=1.0; maximum-scale=1.0; width=device-width;">
      <style type="text/css">
        ${css}
      </style>
    </head>
    <body>
      ${html}
    </body>
  </html>
  `;
}

module.exports = {
  exportHTML: exportHTML
};
