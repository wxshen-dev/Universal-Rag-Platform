from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import fitz

from app.ingestion.parsers.common import normalize_text
from app.ingestion.types import ParsedBlock


class PdfParser:
    def parse(self, file_path: Path) -> list[ParsedBlock]:
        blocks: list[ParsedBlock] = []
        with fitz.open(file_path) as document:
            for page_index, page in enumerate(document, start=1):
                table_blocks, table_rects = self._extract_tables(page, page_index)
                blocks.extend(table_blocks)

                text = normalize_text(self._text_outside_tables(page, table_rects))
                if text:
                    blocks.append(
                        ParsedBlock(
                            text=text,
                            page_no=page_index,
                            metadata={"parser": "pymupdf"},
                        )
                    )
        return blocks

    def parse_with_images(self, file_path: Path, extract_images: bool = True) -> list[ParsedBlock]:
        """解析PDF，可选择提取图片内容"""
        # 首先获取文本内容
        blocks = self.parse(file_path)

        if not extract_images:
            return blocks

        # 提取图片
        try:
            images = self._extract_images(file_path)
            if not images:
                return blocks

            # 导入图片解析器
            from app.ingestion.parsers.image_parser import ImageParser
            image_parser = ImageParser()

            # 识别图片内容
            image_blocks = image_parser.parse_batch(images)

            # 为图片块添加PDF特定的元数据
            for i, block in enumerate(image_blocks):
                block.metadata.update({
                    "source_pdf": file_path.name,
                    "image_index": i,
                    "extraction_method": "pdf_image",
                })

            blocks.extend(image_blocks)

        except Exception as e:
            # 图片提取失败不影响文本内容
            import logging
            logger = logging.getLogger(__name__)
            logger.warning("Image extraction failed for PDF %s: %s", file_path, e)

        return blocks

    def _extract_images(self, file_path: Path) -> List[bytes]:
        """从PDF中提取所有图片"""
        images = []

        try:
            with fitz.open(file_path) as doc:
                for page_num in range(len(doc)):
                    page = doc.load_page(page_num)
                    image_list = page.get_images(full=True)

                    for img in image_list:
                        xref = img[0]
                        base_image = doc.extract_image(xref)
                        image_bytes = base_image["image"]
                        images.append(image_bytes)

            return images

        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.exception("Failed to extract images from PDF: %s", file_path)
            return []

    @staticmethod
    def _extract_text_in_reading_order(page) -> str:
        text_blocks = []
        for block in page.get_text("blocks"):
            block_text = str(block[4]).strip()
            block_type = block[6] if len(block) > 6 else 0
            if block_type != 0 or not block_text:
                continue
            x0, y0 = float(block[0]), float(block[1])
            text_blocks.append((y0, x0, block_text))

        if not text_blocks:
            return page.get_text("text")

        sorted_text = "\n".join(text for _, _, text in sorted(text_blocks, key=lambda item: (item[0], item[1])))
        return sorted_text

    @staticmethod
    def _extract_tables(
        page, page_no: int
    ) -> tuple[list[ParsedBlock], list[tuple[float, float, float, float]]]:
        """用 find_tables() 提取页面中的表格，返回 (表格块, 表格区域列表)。"""
        try:
            table_finder = page.find_tables()
        except Exception:
            return [], []

        table_blocks: list[ParsedBlock] = []
        table_rects: list[tuple[float, float, float, float]] = []

        for table in table_finder.tables:
            rows = table.extract()
            if not rows:
                continue

            headers = [str(c).strip() if c else "" for c in rows[0]]
            data_rows = rows[1:] if len(rows) > 1 else []

            table_rows = []
            for i, row in enumerate(data_rows):
                cells = [str(c).strip() if c else "" for c in row]
                table_rows.append({
                    "row_number": i + 1,
                    "text": " | ".join(cells),
                    "fields": dict(zip(headers, cells)),
                    "group_key": [],
                })

            table_text = table.to_markdown()
            if not normalize_text(table_text):
                continue

            table_blocks.append(
                ParsedBlock(
                    text=table_text,
                    chunk_type="table",
                    page_no=page_no,
                    metadata={
                        "parser": "pymupdf",
                        "headers": headers,
                        "_table_rows": table_rows,
                    },
                )
            )
            table_rects.append(table.bbox)

        return table_blocks, table_rects

    @staticmethod
    def _text_outside_tables(
        page, table_rects: list[tuple[float, float, float, float]]
    ) -> str:
        """提取页面中表格区域以外的文本。"""
        text_blocks = []
        for block in page.get_text("blocks"):
            block_text = str(block[4]).strip()
            block_type = block[6] if len(block) > 6 else 0
            if block_type != 0 or not block_text:
                continue

            bx0, by0, bx1, by1 = float(block[0]), float(block[1]), float(block[2]), float(block[3])
            block_rect = fitz.Rect(bx0, by0, bx1, by1)

            # 跳过与表格区域重叠的文本块
            skip = False
            for tx0, ty0, tx1, ty1 in table_rects:
                table_rect = fitz.Rect(tx0, ty0, tx1, ty1)
                if block_rect.intersects(table_rect):
                    skip = True
                    break
            if skip:
                continue

            text_blocks.append((by0, bx0, block_text))

        if not text_blocks:
            return ""

        return "\n".join(
            text for _, _, text in sorted(text_blocks, key=lambda item: (item[0], item[1]))
        )


class PdfWithImagesParser(PdfParser):
    """支持图片提取的PDF解析器"""

    def parse(self, file_path: Path) -> list[ParsedBlock]:
        """解析PDF，包括图片内容"""
        return self.parse_with_images(file_path, extract_images=True)
