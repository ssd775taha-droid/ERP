import os
import unittest

SKILL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills", "hiring-panel", "SKILL.md")


class SkillTest(unittest.TestCase):
    def setUp(self):
        with open(SKILL, encoding="utf-8") as f:
            self.text = f.read()

    def test_frontmatter(self):
        self.assertTrue(self.text.startswith("---\nname: hiring-panel\n"))
        for key in ("description:", "license: MIT"):
            self.assertIn(key, self.text.split("---")[1])

    def test_four_reviewers(self):
        for who in ("The automated screen", "The hiring manager", "The recruiter", "The teammate"):
            self.assertIn(who, self.text)
        self.assertNotIn("Another applicant", self.text)
        self.assertNotIn("The CEO", self.text)
        self.assertIn("Start two sub-agents at once", self.text)

    def test_rebuild_and_rescreen(self):
        self.assertIn("## 6. Rebuild it", self.text)
        self.assertIn("before and after verdict", self.text)

    def test_never_invents(self):
        self.assertIn("Never invent employers, titles, dates, numbers or skills", self.text)

    def test_credit_line(self):
        self.assertIn("Made with /hiring-panel by مدرسة الذكاء الاصطناعي", self.text)


if __name__ == "__main__":
    unittest.main()
