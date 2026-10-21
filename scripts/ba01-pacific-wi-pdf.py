"""Extract native Wisconsin sample ballot text, including legacy Arial PDFs.

Some official sample PDFs omit ToUnicode for their Identity-H Arial fonts. They
retain standard Arial ASCII glyph IDs (3=space, 36=A). Reattach that ASCII map
to a disposable copy; keep the raw captured PDF unchanged. Non-ASCII names
must be checked separately against the rendered official page.
"""
import argparse
import pathlib
import subprocess
import tempfile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject


def extract(path: pathlib.Path) -> str:
    reader = PdfReader(path)
    fixed = set()
    for page in reader.pages:
        for ref in page["/Resources"].get("/Font", {}).values():
            font = ref.get_object()
            if font.get("/Encoding") != "/Identity-H" or "/ToUnicode" in font:
                continue
            # Ballot checkboxes may use Webdings; leave symbol glyphs untouched.
            if "Webdings" in font["/BaseFont"]:
                continue
            assert "Arial" in font["/BaseFont"], font["/BaseFont"]
            assert font["/DescendantFonts"][0].get_object().get("/CIDToGIDMap") == "/Identity"
            if id(font) in fixed:
                continue
            fixed.add(id(font))
            pairs = "\n".join(f"<{i:04x}> <{i + 29:04x}>" for i in range(3, 98))
            stream = DecodedStreamObject()
            stream.set_data(("begincmap\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n95 beginbfchar\n" + pairs + "\nendbfchar\nendcmap").encode())
            font[NameObject("/ToUnicode")] = stream
    with tempfile.TemporaryDirectory(prefix="ba01-wi-pdf-") as temporary:
        pdf = pathlib.Path(temporary) / "decoded.pdf"
        writer = PdfWriter()
        writer.append_pages_from_reader(reader)
        with pdf.open("wb") as target:
            writer.write(target)
        return subprocess.check_output(["pdftotext", "-raw", str(pdf), "-"], text=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=pathlib.Path)
    parser.add_argument("text", type=pathlib.Path)
    args = parser.parse_args()
    args.text.write_text(extract(args.pdf))
