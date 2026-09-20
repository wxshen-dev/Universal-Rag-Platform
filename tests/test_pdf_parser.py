from __future__ import annotations

import fitz

from app.ingestion.parsers.pdf_parser import PdfParser


def _make_table_page(page, x0=50, y0=50, col_width=100, row_height=20):
    """在页面上绘制一个带线条的表格（Name | Age, Alice | 30, Bob | 25）。"""
    x1 = x0 + col_width * 2
    # 3 行 × 2 列
    for r in range(4):
        y = y0 + r * row_height
        page.draw_line((x0, y), (x1, y))
    for c in range(3):
        x = x0 + c * col_width
        page.draw_line((x, y0), (x, y0 + row_height * 3))

    page.insert_text((x0 + 5, y0 + 15), "Name")
    page.insert_text((x0 + col_width + 5, y0 + 15), "Age")
    page.insert_text((x0 + 5, y0 + row_height + 15), "Alice")
    page.insert_text((x0 + col_width + 5, y0 + row_height + 15), "30")
    page.insert_text((x0 + 5, y0 + row_height * 2 + 15), "Bob")
    page.insert_text((x0 + col_width + 5, y0 + row_height * 2 + 15), "25")


def test_pdf_parser_sorts_text_blocks_by_visual_reading_order(tmp_path):
    pdf_path = tmp_path / "out-of-order-blocks.pdf"
    document = fitz.open()
    page = document.new_page(width=595, height=842)

    page.insert_text((72, 220), "6.3.3 approval")
    page.insert_text((72, 565), "note after code")
    page.insert_text((72, 590), "6.3.4 next section")
    page.insert_text((84, 280), "$re = $this->flowInterfaceService->agreeFlow(...);")
    document.save(pdf_path)
    document.close()

    blocks = PdfParser().parse(pdf_path)

    assert len(blocks) == 1
    text = blocks[0].text
    assert text.index("$re = $this->flowInterfaceService->agreeFlow") < text.index("note after code")
    assert text.index("note after code") < text.index("6.3.4 next section")


# ── PDF table detection ───────────────────────────────────────


def test_pdf_parser_extracts_table(tmp_path):
    pdf_path = tmp_path / "table.pdf"
    doc = fitz.open()
    page = doc.new_page()
    _make_table_page(page)
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)

    table_blocks = [b for b in blocks if b.chunk_type == "table"]
    assert len(table_blocks) == 1

    tb = table_blocks[0]
    assert tb.metadata["headers"] == ["Name", "Age"]
    assert len(tb.metadata["_table_rows"]) == 2
    assert tb.metadata["_table_rows"][0]["fields"] == {"Name": "Alice", "Age": "30"}
    assert tb.page_no == 1


def test_pdf_parser_table_markdown_output(tmp_path):
    pdf_path = tmp_path / "table_md.pdf"
    doc = fitz.open()
    page = doc.new_page()
    _make_table_page(page)
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)
    table_blocks = [b for b in blocks if b.chunk_type == "table"]

    assert len(table_blocks) == 1
    text = table_blocks[0].text
    assert "Name" in text
    assert "Alice" in text
    assert "---" in text


def test_pdf_parser_mixed_text_and_table(tmp_path):
    pdf_path = tmp_path / "mixed.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 30), "Introduction paragraph before table.")
    _make_table_page(page, y0=80)
    page.insert_text((72, 200), "Conclusion paragraph after table.")
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)

    table_blocks = [b for b in blocks if b.chunk_type == "table"]
    text_blocks = [b for b in blocks if b.chunk_type == "text"]

    assert len(table_blocks) == 1
    assert len(text_blocks) >= 1
    # 文本块不应包含表格内容
    for tb in text_blocks:
        assert "Alice" not in tb.text


def test_pdf_parser_no_tables(tmp_path):
    pdf_path = tmp_path / "notable.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Just plain text, no tables here.")
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)

    assert all(b.chunk_type == "text" for b in blocks)
    assert len(blocks) == 1


def test_pdf_parser_multiple_tables_on_page(tmp_path):
    pdf_path = tmp_path / "multi_table.pdf"
    doc = fitz.open()
    page = doc.new_page()
    _make_table_page(page, y0=50)
    _make_table_page(page, y0=200)
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)
    table_blocks = [b for b in blocks if b.chunk_type == "table"]

    assert len(table_blocks) == 2


def test_pdf_parser_table_rows_metadata_format(tmp_path):
    """确保 _table_rows 格式兼容 TableAwareChunkingStrategy。"""
    pdf_path = tmp_path / "meta.pdf"
    doc = fitz.open()
    page = doc.new_page()
    _make_table_page(page)
    doc.save(pdf_path)
    doc.close()

    blocks = PdfParser().parse(pdf_path)
    table_blocks = [b for b in blocks if b.chunk_type == "table"]
    rows = table_blocks[0].metadata["_table_rows"]

    for row in rows:
        assert "row_number" in row
        assert "text" in row
        assert "fields" in row
        assert "group_key" in row
        assert isinstance(row["fields"], dict)
