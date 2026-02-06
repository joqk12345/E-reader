
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

def test_translation_functionality():
    print("=== 开始测试 Tauri 应用翻译功能 ===\n")

    # 配置 Chrome 选项
    chrome_options = Options()
    chrome_options.add_argument("--start-maximized")

    try:
        # 启动浏览器
        driver = webdriver.Chrome(options=chrome_options)
        driver.get("http://localhost:1420")

        print("✅ 应用已成功加载")

        # 等待图书馆页面加载
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "document-list"))
        )
        print("✅ 图书馆页面已加载")

        # 检查是否有文档
        document_cards = driver.find_elements(By.CLASS_NAME, "document-card")
        if len(document_cards) == 0:
            print("❌ 图书馆中没有文档，请先添加文档后再测试")
            return False

        print(f"✅ 图书馆中有 {len(document_cards)} 个文档")

        # 选择第一个文档
        first_document = document_cards[0]
        first_document.click()
        print("✅ 已选择第一个文档")

        # 等待阅读页面加载
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "reader-content"))
        )
        print("✅ 阅读页面已加载")

        # 开启双语模式
        bilingual_button = driver.find_element(By.XPATH, "//button[contains(text(), 'Bilingual')]")
        if "Bilingual Off" in bilingual_button.text:
            bilingual_button.click()
            print("✅ 已开启双语模式")
        else:
            print("✅ 双语模式已处于开启状态")

        # 等待翻译按钮出现
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.XPATH, "//button[contains(text(), 'Translate')]"))
        )

        # 点击翻译按钮
        translate_buttons = driver.find_elements(By.XPATH, "//button[contains(text(), 'Translate')]")
        if len(translate_buttons) > 0:
            translate_buttons[0].click()
            print("✅ 已点击翻译按钮")

            # 等待翻译结果加载
            try:
                WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.CLASS_NAME, "text-blue-600"))
                )

                # 检查翻译结果
                translations = driver.find_elements(By.CLASS_NAME, "text-blue-600")
                found_translation = False
                for translation in translations:
                    if "Loading..." not in translation.text and "Translate" not in translation.text:
                        found_translation = True
                        print(f"✅ 翻译成功: {translation.text}")
                        break

                if not found_translation:
                    print("❌ 未找到翻译结果")
                    return False

            except Exception as e:
                print(f"❌ 翻译超时或失败: {e}")
                return False
        else:
            print("❌ 未找到翻译按钮")
            return False

        print("\n=== 测试完成 ===\n")
        print("🎉 翻译功能正常工作!")

        return True

    except Exception as e:
        print(f"❌ 测试过程中出错: {e}")
        return False

    finally:
        # 关闭浏览器
        if 'driver' in locals():
            time.sleep(2)
            driver.quit()

if __name__ == "__main__":
    test_translation_functionality()
