function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function sendTextError(res, status, message) {
  const safeMessage = escapeHtml(String(message));
  res.status(status).type('text').send(safeMessage);
}

module.exports = { sendTextError };
