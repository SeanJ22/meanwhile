"""Read public election tables; never print contact fields."""
from html.parser import HTMLParser
import re


class ElectionRows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in {'td', 'th'}:
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_endtag(self, tag):
        if tag in {'td', 'th'} and self.cell is not None:
            if self.row is not None:
                self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def prove_rows(raw, rows, indices):
    parser = ElectionRows()
    parser.feed(raw.decode('utf-8-sig'))
    clean = lambda value: re.sub(r'\s+', ' ', value).strip()
    supported = {tuple(clean(row[i]) for i in indices) for row in parser.rows if len(row) > max(indices)}
    for row in rows:
        assert tuple(clean(row[i]) for i in indices) in supported, 'Derived public ballot row must match original official HTML'
    return len(rows)
