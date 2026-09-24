import asyncio, sys
from playwright.async_api import async_playwright
src, out = sys.argv[1], sys.argv[2]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1920,"height":1080})
        await pg.goto("file://"+src, wait_until="networkidle")
        await pg.evaluate("document.fonts.ready")
        await pg.emulate_media(media="print")
        await pg.pdf(path=out, width="1920px", height="1080px", print_background=True, prefer_css_page_size=True)
        await b.close()
asyncio.run(main())
