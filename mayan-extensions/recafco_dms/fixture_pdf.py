"""Builds a minimal one-page PDF with searchable text. Test fixtures only."""


def make_pdf(text):
    escaped = (
        text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    )
    stream = 'BT /F1 18 Tf 72 720 Td ({}) Tj ET'.format(escaped)
    objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        (
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
            '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
        ),
        '<< /Length {} >>\nstream\n{}\nendstream'.format(len(stream), stream),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ]
    output = '%PDF-1.4\n'
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output.encode('latin-1')))
        output += '{} 0 obj\n{}\nendobj\n'.format(index, body)
    xref_offset = len(output.encode('latin-1'))
    output += 'xref\n0 {}\n0000000000 65535 f \n'.format(len(objects) + 1)
    for offset in offsets:
        output += '{:010d} 00000 n \n'.format(offset)
    output += 'trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n'.format(
        len(objects) + 1, xref_offset
    )
    return output.encode('latin-1')
